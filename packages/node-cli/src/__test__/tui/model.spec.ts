import { describe, expect, it } from 'vitest'
import type { DashboardSample } from '../../tui/model.js'
import {
	appendSample,
	buildSample,
	chart,
	filterProcesses,
	observation,
	resultLines,
	validateParameters,
	viewportLines,
} from '../../tui/model.js'

const sample = (at: number, cpu: number | null = null): DashboardSample => ({
	at,
	cpu,
	rss: null,
	heapUsed: null,
	heapTotal: null,
	errors: null,
	timers: null,
	source: 'inspector',
	sdk: false,
	agent: false,
	ageMs: 0,
	stale: false,
})

describe('TUI dashboard truth', () => {
	it('preserves zero, missing values and multi-core CPU without turning unavailable data into zero', () => {
		const view = buildSample(
			{ success: true, command: 'monitor-cpu', data: { cpuPercent: 246.5, source: 'inspector' } },
			{ success: false, command: 'monitor-memory', error: 'disconnected' },
			null,
			10000
		)
		expect(view.cpu).toBe(246.5)
		expect(view.rss).toBeNull()
		expect(view.errors).toBeNull()
		expect(
			buildSample(
				{ success: true, command: 'monitor-cpu', data: { cpuPercent: 0, source: 'agent' } },
				{ success: true, command: 'monitor-memory', data: { rss: 0, heapUsed: 0, heapTotal: 0, source: 'agent' } },
				{
					metrics: { errors: [], timers: [] },
					registeredSubjects: ['cpu', 'memory', 'jsError', 'timeout'],
					updatedAt: { cpu: 10000, memory: 10000, errors: 10000, timers: 10000 },
					intervals: { cpu: 1000, memory: 1000 },
				},
				10000
			)
		).toMatchObject({ cpu: 0, rss: 0, errors: 0, timers: 0, sdk: true, agent: true })
	})
	it('marks expired Agent observations and leaves gaps in the real-time chart', () => {
		const old = buildSample(
			{ success: true, command: 'monitor-cpu', data: { cpuPercent: 88, source: 'agent' } },
			{ success: true, command: 'monitor-memory', data: { rss: 1024, source: 'agent' } },
			{
				metrics: {},
				registeredSubjects: ['cpu'],
				updatedAt: { cpu: 1000, memory: 1000 },
				intervals: { cpu: 1000, memory: 1000 },
			},
			10000
		)
		expect(old).toMatchObject({ stale: true, ageMs: 9000 })
		expect(chart([sample(8000, 20), sample(10000, null)], 'cpu', 10000, 60)).toBe(`${'·'.repeat(57)}▂··`)
	})
	it('bounds the sample history by time and count, including when time moves backwards', () => {
		let history: DashboardSample[] = []
		for (let at = 0; at < 120000; at += 500) history = appendSample(history, sample(at, 100))
		expect(history).toHaveLength(120)
		expect(history[0].at).toBe(60000)
		expect(appendSample(history, sample(1))).toHaveLength(1)
	})
	it('describes sustained high CPU as an observation requiring profiling evidence', () => {
		const high = [sample(0, 90), sample(1000, 105), sample(2000, 100)]
		expect(observation(high)).toMatchObject({ title: 'CPU 使用率连续偏高', action: 'cpuprofile' })
		expect(observation(high).detail).toContain('尚不能确定具体函数')
		expect(observation([sample(0)])).toMatchObject({ title: '等待有效采样' })
	})
})

describe('TUI operation parameters and output', () => {
	it('rejects invalid timing and conflicting code input before starting a target operation', () => {
		expect(validateParameters('cpuprofile', { duration: '0', timeout: '30000', dir: '.' }).error).toContain('时长')
		expect(validateParameters('cpuprofile', { duration: '10000', timeout: '5000', dir: '.' }).error).toContain('超时')
		expect(
			validateParameters('run-code', { timeout: '30000', code: 'return false', file: '/tmp/a.js' }).error
		).toContain('同时')
		expect(validateParameters('run-code', { timeout: '30000', code: '', file: '' }).error).toContain('代码')
		expect(validateParameters('cpuprofile', { duration: '10000', timeout: '30000', dir: '/tmp/报告' })).toEqual({
			options: { duration: 10000, dir: '/tmp/报告' },
			timeout: 30000,
		})
	})
	it('renders falsey results, structured errors and artifact paths as actual result content', () => {
		expect(resultLines({ success: true, command: 'run-code', data: false }, false)).toContain('false')
		expect(
			resultLines({ success: true, command: 'report', data: { filename: '/tmp/report.json' } }, false).join('\n')
		).toContain('/tmp/report.json')
		const failure = resultLines(
			{
				success: false,
				command: 'memory',
				error: 'lost target',
				errorCode: 'TARGET_EXITED',
				suggestion: 'Select a live process',
			},
			false
		).join('\n')
		expect(failure).toContain('TARGET_EXITED')
		expect(failure).toContain('Select a live process')
	})
	it('hides error stacks until expanded and preserves non-stack error metadata', () => {
		const result = {
			success: true,
			command: 'errors',
			data: {
				errors: [
					{
						name: 'Error',
						message: 'boom',
						stack: 'Error: boom\n    at execute (/app/server.js:8:1)',
						timestamp: 1000,
					},
				],
			},
		}
		expect(resultLines(result, false).join('\n')).not.toContain('at execute')
		expect(resultLines(result, true).join('\n')).toContain('at execute')
		expect(resultLines(result, false).join('\n')).toContain('boom')
	})
})

describe('TUI process and terminal navigation', () => {
	it('searches PID and commands without losing the full selected command', () => {
		const processes = [
			{ pid: 9123, ppid: 1, stime: '', time: '', command: 'node /app/支付-api.js --port=3000' },
			{ pid: 456, ppid: 1, stime: '', time: '', command: 'node /app/jobs.js' },
		]
		expect(filterProcesses(processes, '支付')[0].command).toBe(processes[0].command)
		expect(filterProcesses(processes, '456').map((p) => p.pid)).toEqual([456])
		expect(filterProcesses(processes, 'missing')).toEqual([])
	})
	it('scrolls content and clips CJK strings by terminal cells rather than code units', () => {
		expect(viewportLines(['首行', '中文AB', '尾行'], 1, 1, 4)).toEqual(['中…'])
		expect(viewportLines(['abc', 'def', 'ghi'], 99, 2, 20)).toEqual(['def', 'ghi'])
	})
})

// A missing hard wrap previously hid the tail of long commands and stack traces.
it('wraps full CJK commands and stack traces without losing characters', async () => {
	const { wrapLines } = await import('../../tui/model.js')
	expect(wrapLines(['中文ABCD', 'at file.js:20'], 4)).toEqual(['中文', 'ABCD', 'at f', 'ile.', 'js:2', '0'])
})

it('uses real Agent subject metadata keys and exposes truncation instead of presenting partial counts as totals', () => {
	const view = buildSample(
		{ success: true, command: 'monitor-cpu', data: { cpuPercent: 12, source: 'agent' } },
		{ success: true, command: 'monitor-memory', data: { rss: 1024, source: 'agent' } },
		{
			metrics: { errors: [], timers: [] },
			registeredSubjects: ['CPU', 'Memory', 'JSError', 'Timeout'],
			updatedAt: { CPU: 9000, Memory: 9000, JSError: 9000, Timeout: 9000 },
			intervals: { CPU: 1000, Memory: 1000, JSError: 1000, Timeout: 1000 },
			truncated: { errors: 5, timers: 2 },
		},
		10000
	)
	expect(view).toMatchObject({ stale: false, ageMs: 1000, errorsDropped: 5, timersDropped: 2 })
})

it('keeps a full minute visible on a compressed chart instead of silently shortening the time window', () => {
	expect(chart([sample(-48000, 20), sample(10000, null)], 'cpu', 10000, 3)).toBe('▂··')
})

it('warns that the latest sample aged out while a connection is waiting', () => {
	expect(observation([sample(1000, 99), sample(2000, 99), sample(3000, 99)], 12000).title).toBe('样本已过期')
})

it('honors a longer configured Agent interval when deciding whether the current sample expired', () => {
	const view = buildSample(
		{ success: true, command: 'monitor-cpu', data: { cpuPercent: 12, source: 'agent' } },
		{ success: true, command: 'monitor-memory', data: { rss: 1024, source: 'agent' } },
		{
			metrics: {},
			registeredSubjects: ['CPU', 'Memory'],
			updatedAt: { CPU: 9000, Memory: 9000 },
			intervals: { CPU: 10000, Memory: 10000 },
		},
		10000
	)
	expect(observation([view], 20000).title).toBe('已取得进程采样')
	expect(observation([view], 40000).title).toBe('样本已过期')
})

it('keeps an error observation fresh for the JSError 30-second interval while CPU samples update faster', () => {
	const cpu = { success: true, command: 'monitor-cpu', data: { cpuPercent: 4, source: 'agent' } }
	const memory = { success: true, command: 'monitor-memory', data: { rss: 1024, source: 'agent' } }
	const metadata = {
		metrics: {
			errors: [{ name: 'Error', message: 'fixture error', stack: 'Error: fixture error', time: 10000 }],
			timers: [],
		},
		registeredSubjects: ['CPU', 'Memory', 'JSError', 'Timeout'],
		updatedAt: { CPU: 40000, Memory: 40000, JSError: 10000, Timeout: 40000 },
		intervals: { CPU: 1000, Memory: 1000, JSError: 30000, Timeout: 1000 },
	}
	const fresh = buildSample(cpu, memory, metadata, 40000)
	expect(fresh.errorsStale).toBe(false)
	expect(observation([fresh]).title).toBe('采集到 1 条最近错误')
	const expired = buildSample(
		cpu,
		memory,
		{ ...metadata, updatedAt: { ...metadata.updatedAt, CPU: 100001, Memory: 100001, Timeout: 100001 } },
		100001
	)
	expect(expired.errorsStale).toBe(true)
	expect(observation([expired]).title).toBe('已取得进程采样')
})

it('plots SDK values at their original timestamps rather than at the later HTTP query time', () => {
	const queried = buildSample(
		{ success: true, command: 'monitor-cpu', data: { cpuPercent: 20, source: 'agent' } },
		{ success: true, command: 'monitor-memory', data: { rss: 1024, source: 'agent' } },
		{
			metrics: {},
			registeredSubjects: ['CPU', 'Memory'],
			updatedAt: { CPU: 8000, Memory: 8000 },
			intervals: { CPU: 1000, Memory: 1000 },
		},
		10000
	)
	expect(chart([queried], 'cpu', 10000, 60)).toBe(`${'·'.repeat(57)}▂··`)
})

it('retains only the five actual most recent error messages for the C overview table', () => {
	const errors = Array.from({ length: 8 }, (_, index) => ({
		timestamp: index * 1000,
		name: 'Error',
		message: `actual error ${index}`,
	}))
	const view = buildSample(
		{
			success: true,
			command: 'monitor-cpu',
			data: { cpuPercent: 2, source: 'agent', sampledAt: 10000, interval: 250 },
		},
		{ success: true, command: 'monitor-memory', data: { rss: 1024, source: 'agent', sampledAt: 10000, interval: 250 } },
		{
			metrics: { errors },
			registeredSubjects: ['CPU', 'Memory', 'JSError'],
			updatedAt: { CPU: 10000, Memory: 10000, JSError: 10000 },
			intervals: { CPU: 250, Memory: 250, JSError: 30000 },
		},
		10000
	)
	expect(view.recentErrors?.map((error) => error.message)).toEqual([
		'actual error 7',
		'actual error 6',
		'actual error 5',
		'actual error 4',
		'actual error 3',
	])
})

it('requires three distinct CPU samples when memory refreshes more often than CPU', () => {
	const history = [10000, 10250, 10500].map((at) =>
		buildSample(
			{
				success: true,
				command: 'monitor-cpu',
				data: { cpuPercent: 90, source: 'agent', sampledAt: 10000, interval: 1000 },
			},
			{ success: true, command: 'monitor-memory', data: { rss: 1024, source: 'agent', sampledAt: at, interval: 250 } },
			{ metrics: {}, registeredSubjects: ['CPU', 'Memory'] },
			at
		)
	)
	expect(observation(history, 10500).title).toBe('已取得进程采样')
})

it('preserves a saved artifact and complete falsey data when cleanup turns an otherwise completed operation into failure', () => {
	const lines = resultLines(
		{
			success: false,
			command: 'cpuprofile',
			error: 'Inspector cleanup failed',
			errorCode: 'CLEANUP_FAILED',
			data: { filename: '/tmp/saved-evidence.cpuprofile', source: 'inspector', completed: false, samples: 0 },
		},
		false
	).join('\n')
	expect(lines).toContain('CLEANUP_FAILED')
	expect(lines).toContain('/tmp/saved-evidence.cpuprofile')
	expect(lines).toContain('"completed": false')
	expect(lines).toContain('"samples": 0')
})

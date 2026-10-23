import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OutputData } from '../../core/types.js'
import { TuiController } from '../../tui/controller.js'
import { isExpired, observation } from '../../tui/model.js'

const firstPid = process.pid + 1001
const secondPid = process.pid + 2002
const processFixture = (pid: number) => ({
	pid,
	ppid: 1,
	stime: '10:00',
	time: '0:00',
	command: `node /app/service-${pid}.js`,
})
const instances: TuiController[] = []
afterEach(() => {
	for (const instance of instances.splice(0)) instance.dispose()
	vi.useRealTimers()
})
const flush = () => new Promise((resolve) => setTimeout(resolve, 10))

function makeController(execute: ConstructorParameters<typeof TuiController>[0]['execute']) {
	const instance = new TuiController({
		getProcesses: () => [processFixture(firstPid), processFixture(secondPid)],
		getProcessInfo: async () => null,
		execute,
		now: () => 10000,
		pollInterval: 60000,
	})
	instances.push(instance)
	return instance
}

describe('guided TUI controller', () => {
	it('opens the explicitly requested demo PID instead of sampling the first unrelated process', async () => {
		const controller = makeController(async (command, _options, settings) => ({
			success: true,
			command,
			data: command === 'monitor-cpu' ? { cpuPercent: settings.pid === secondPid ? 42 : 1 } : { rss: 100 },
		}))
		await controller.refreshProcesses(secondPid)
		await flush()
		expect(controller.getSnapshot()).toMatchObject({ step: 'status', selected: { pid: secondPid } })
		expect(controller.getSnapshot().samples.at(-1)?.cpu).toBe(42)
	})
	it('keeps the selector open with an actionable error when an explicitly requested PID has exited', async () => {
		const controller = makeController(async (command) => ({ success: true, command }))
		await controller.refreshProcesses(99999999)
		expect(controller.getSnapshot().step).toBe('select')
		expect(controller.getSnapshot().selected).toBeUndefined()
		expect(controller.getSnapshot().error).toContain('99999999')
	})
	it('ignores late samples from a previous target after switching processes', async () => {
		let release: (value: OutputData) => void = () => {}
		const controller = makeController(async (command, _options, settings) => {
			if (settings.pid === firstPid && command === 'monitor-cpu')
				return new Promise((resolve) => {
					release = resolve
				})
			return {
				success: true,
				command,
				data: command === 'monitor-cpu' ? { cpuPercent: 22, source: 'inspector' } : { rss: 100, source: 'inspector' },
			}
		})
		await controller.refreshProcesses()
		controller.selectProcess(processFixture(firstPid))
		await flush()
		controller.selectProcess(processFixture(secondPid))
		await flush()
		release({ success: true, command: 'monitor-cpu', data: { cpuPercent: 999, source: 'inspector' } })
		await flush()
		expect(controller.getSnapshot().selected?.pid).toBe(secondPid)
		expect(controller.getSnapshot().samples.map((sample) => sample.cpu)).toEqual([22])
	})
	it('validates parameters, retains actual false results and supports repeating an operation', async () => {
		const controller = makeController(async (command) => ({
			success: true,
			command,
			data: command === 'run-code' ? false : {},
		}))
		controller.openAction('run-code')
		await controller.run()
		expect(controller.getSnapshot().step).toBe('collect')
		expect(controller.getSnapshot().error).toContain('代码')
		controller.selectProcess(processFixture(firstPid))
		await flush()
		controller.openAction('run-code')
		controller.setField('code', 'return false')
		await controller.run()
		expect(controller.getSnapshot()).toMatchObject({ step: 'result', result: { data: false } })
		controller.retry()
		expect(controller.getSnapshot()).toMatchObject({ step: 'collect', fields: { code: 'return false' } })
	})
	it('waits for cancellation cleanup before exposing a retryable cancelled result', async () => {
		let finish: (value: OutputData) => void = () => {}
		const controller = makeController(async (command) =>
			command === 'report'
				? new Promise((resolve) => {
						finish = resolve
					})
				: { success: true, command, data: {} }
		)
		controller.selectProcess(processFixture(firstPid))
		await flush()
		controller.openAction('report')
		const running = controller.run()
		controller.cancelRun()
		expect(controller.getSnapshot()).toMatchObject({ step: 'running', cancelling: true })
		expect(controller.getSnapshot().result).toBeUndefined()
		controller.retry()
		controller.openAction('memory')
		controller.selectProcess(processFixture(secondPid))
		await controller.run()
		expect(controller.getSnapshot()).toMatchObject({ step: 'running', selected: { pid: firstPid }, actionIndex: 5 })
		finish({ success: true, command: 'report', data: { filename: '/tmp/late.json' } })
		await running
		expect(controller.getSnapshot().result?.errorCode).toBe('CANCELLED')
		expect(controller.getSnapshot().result?.suggestion).toContain('目标操作')
	})
	it('retains prior results and scrolls a changed process list safely after a failed refresh', async () => {
		let fail = false
		const controller = new TuiController({
			getProcesses: () => {
				if (fail) throw new Error('permission denied')
				return [processFixture(firstPid)]
			},
			execute: async (command) => ({ success: true, command }),
			getProcessInfo: async () => null,
		})
		instances.push(controller)
		await controller.refreshProcesses()
		fail = true
		await controller.refreshProcesses()
		expect(controller.getSnapshot().processes).toHaveLength(1)
		expect(controller.getSnapshot().error).toContain('permission denied')
		controller.setQuery('no match')
		controller.moveSelection(1)
		expect(controller.getSnapshot().processIndex).toBe(0)
	})
	it('can view history and artifacts without selecting a target', async () => {
		const controller = makeController(async (command, options, settings) => ({
			success: true,
			command,
			data: { records: settings.pid === 0 && options.artifacts ? [{ path: '/tmp/evidence.cpuprofile' }] : [] },
		}))
		controller.openAction('artifacts')
		await controller.run()
		expect(controller.getSnapshot().result?.data.records[0].path).toBe('/tmp/evidence.cpuprofile')
	})
})

describe('SDK sampling cadence', () => {
	it('refreshes a healthy 250ms sender before its actual sample expires', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(10000)
		const controller = new TuiController({
			getProcesses: () => [processFixture(firstPid)],
			getProcessInfo: async () => ({
				metrics: {},
				registeredSubjects: ['CPU', 'Memory'],
				updatedAt: { CPU: Math.floor(Date.now() / 250) * 250, Memory: Math.floor(Date.now() / 250) * 250 },
				intervals: { CPU: 250, Memory: 250 },
			}),
			execute: async (command) => ({
				success: true,
				command,
				data: command === 'monitor-cpu' ? { cpuPercent: 70, source: 'agent' } : { rss: 1024, source: 'agent' },
			}),
		})
		instances.push(controller)
		controller.selectProcess(processFixture(firstPid))
		await vi.advanceTimersByTimeAsync(0)
		for (let time = 50; time <= 1500; time += 50) {
			await vi.advanceTimersByTimeAsync(50)
			const current = controller.getSnapshot().samples.at(-1)
			if (!current) throw new Error('Expected a real dashboard sample')
			expect(isExpired(current, Date.now()), `sample expired after ${time}ms`).toBe(false)
		}
		expect(controller.getSnapshot().samples.length).toBeGreaterThanOrEqual(6)
	})
	it('does not turn repeated queries of one cached SDK timestamp into extra samples or a sustained CPU warning', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(10000)
		const controller = new TuiController({
			getProcesses: () => [processFixture(firstPid)],
			getProcessInfo: async () => ({
				metrics: {},
				registeredSubjects: ['CPU', 'Memory'],
				updatedAt: { CPU: 10000, Memory: 10000 },
				intervals: { CPU: 250, Memory: 250 },
			}),
			execute: async (command) => ({
				success: true,
				command,
				data: command === 'monitor-cpu' ? { cpuPercent: 90, source: 'agent' } : { rss: 1024, source: 'agent' },
			}),
			pollInterval: 100,
		})
		instances.push(controller)
		controller.selectProcess(processFixture(firstPid))
		await vi.advanceTimersByTimeAsync(400)
		expect(controller.getSnapshot().samples).toHaveLength(1)
		expect(observation(controller.getSnapshot().samples, Date.now()).title).toBe('已取得进程采样')
	})
})

it('opens a newly selected process in a clean C overview with the default CPU Profile task', async () => {
	const controller = makeController(async (command) => ({ success: true, command, data: {} }))
	controller.selectProcess(processFixture(firstPid))
	controller.openAction('run-code')
	controller.setField('code', 'return 0')
	controller.setWorkspaceTab('memory')
	controller.switchProcess()
	controller.selectProcess(processFixture(secondPid))
	expect(controller.getSnapshot()).toMatchObject({
		workspaceTab: 'overview',
		workspaceArea: 'overview',
		actionIndex: 1,
		fields: { duration: '10000', dir: '.', timeout: '30000' },
	})
	expect(controller.getSnapshot().fields.code).toBeUndefined()
})

it('waits for a passive Inspector sample to settle before shutdown completes', async () => {
	let finish: (value: OutputData) => void = () => {}
	const controller = makeController(async (command) =>
		command === 'monitor-cpu'
			? new Promise((resolve) => {
					finish = resolve
				})
			: { success: true, command, data: {} }
	)
	controller.selectProcess(processFixture(firstPid))
	await flush()
	let closed = false
	const closing = controller.shutdown().then(() => {
		closed = true
	})
	await flush()
	expect(closed).toBe(false)
	expect(controller.getSnapshot().closing).toBe(true)
	finish({ success: true, command: 'monitor-cpu', data: { cpuPercent: 90, source: 'inspector' } })
	await closing
	expect(closed).toBe(true)
	expect(controller.getSnapshot().samples).toEqual([])
})

it('does not begin a diagnostic task until the previous passive Inspector sample has finished cleanup', async () => {
	let finishSample: (value: OutputData) => void = () => {}
	let reportStarted = false
	const controller = makeController(async (command) => {
		if (command === 'monitor-cpu')
			return new Promise((resolve) => {
				finishSample = resolve
			})
		if (command === 'report') reportStarted = true
		return { success: true, command, data: {} }
	})
	controller.selectProcess(processFixture(firstPid))
	await flush()
	controller.openAction('report')
	const running = controller.run()
	await flush()
	expect(reportStarted).toBe(false)
	expect(controller.getSnapshot().step).toBe('running')
	finishSample({ success: false, command: 'monitor-cpu', error: 'cancelled after cleanup' })
	await running
	expect(reportStarted).toBe(true)
	expect(controller.getSnapshot().result).toMatchObject({ command: 'report', success: true })
})

it('waits for the previous target sample to clean up before starting samples for a newly selected target', async () => {
	let finishSample: (value: OutputData) => void = () => {}
	let secondStarted = false
	const controller = makeController(async (command, _options, settings) => {
		if (command === 'monitor-cpu' && settings.pid === firstPid)
			return new Promise((resolve) => {
				finishSample = resolve
			})
		if (command === 'monitor-cpu' && settings.pid === secondPid) secondStarted = true
		return { success: true, command, data: command === 'monitor-cpu' ? { cpuPercent: 22, source: 'inspector' } : {} }
	})
	controller.selectProcess(processFixture(firstPid))
	await flush()
	controller.switchProcess()
	controller.selectProcess(processFixture(secondPid))
	await flush()
	expect(secondStarted).toBe(false)
	expect(controller.getSnapshot().selected?.pid).toBe(secondPid)
	finishSample({ success: false, command: 'monitor-cpu', error: 'cancelled after cleanup' })
	await flush()
	expect(secondStarted).toBe(true)
	expect(controller.getSnapshot().samples.map((sample) => sample.cpu)).toEqual([22])
})

it('can cancel a queued task while passive Inspector cleanup is still pending without ever starting the task', async () => {
	let finishSample: (value: OutputData) => void = () => {}
	let reportStarted = false
	const controller = makeController(async (command) => {
		if (command === 'monitor-cpu')
			return new Promise((resolve) => {
				finishSample = resolve
			})
		if (command === 'report') reportStarted = true
		return { success: true, command, data: {} }
	})
	controller.selectProcess(processFixture(firstPid))
	await flush()
	controller.openAction('report')
	const running = controller.run()
	controller.cancelRun()
	await flush()
	expect(reportStarted).toBe(false)
	expect(controller.getSnapshot()).toMatchObject({ step: 'running', cancelling: true })
	finishSample({ success: false, command: 'monitor-cpu', error: 'cancelled after cleanup' })
	await running
	expect(reportStarted).toBe(false)
	expect(controller.getSnapshot().result).toMatchObject({ command: 'report', errorCode: 'CANCELLED' })
})

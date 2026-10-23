import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import type { DiagnosticPlugin } from '../core/plugin.js'
import type { DiagnosticContext } from '../core/types.js'
import { fail, ok, wait } from '../helper.js'
import {
	buildDiagnosisReport,
	type CpuProfile,
	type DiagnosisSamples,
	type DiagnosisScenario,
	summarizeCpuProfile,
	type TimerEvidence,
} from '../services/diagnosis.js'
import { cpuProfilePlugin } from './cpu-profile.js'
import { monitorMemoryPlugin } from './monitor-memory.js'
import { timersPlugin } from './timers.js'

interface Snapshot<T> {
	data: T
	source: string
	at: number
	truncated: number
}
function throwIfAborted(ctx: DiagnosticContext) {
	if (ctx.signal?.aborted)
		throw ctx.signal.reason instanceof Error ? ctx.signal.reason : new DOMException('Operation cancelled', 'AbortError')
}
function elapsed<T>(first: Snapshot<T>, second: Snapshot<T>): number {
	if (first.source !== second.source)
		throw new Error('Data source changed between samples; repeat the diagnosis with a stable source')
	const duration = second.at - first.at
	if (!Number.isFinite(duration) || duration <= 0)
		throw new Error('Two distinct samples were not collected; increase --duration beyond the SDK sampling interval')
	return duration
}

export const diagnosePlugin: DiagnosticPlugin = {
	name: 'diagnose',
	label: '组合诊断',
	description: 'Collect measured CPU hotspots, memory changes and timer growth evidence',
	options: [
		{
			flags: '-d, --duration <ms>',
			description: 'Observation window in milliseconds; SDK growth requires two distinct samples',
			defaultValue: '3000',
		},
		{
			flags: '--scenario <scenario>',
			description: 'Evidence to collect: cpu, memory, timers or all',
			defaultValue: 'all',
		},
	],
	async execute(ctx, options) {
		const duration = Number(options.duration ?? 3000)
		const scenario = String(options.scenario ?? 'all') as DiagnosisScenario
		if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 3600000)
			return fail('--duration must be an integer between 1 and 3600000 ms', 'INVALID_ARGUMENT')
		if (!['all', 'cpu', 'memory', 'timers'].includes(scenario))
			return fail('--scenario must be cpu, memory, timers or all', 'INVALID_ARGUMENT')
		throwIfAborted(ctx)
		const started = performance.now()
		const samples: DiagnosisSamples = {
			scenario,
			durationMs: 0,
			startedAt: new Date().toISOString(),
			completedAt: '',
			unavailable: [],
		}
		const wanted = (kind: string) => scenario === 'all' || scenario === kind
		const unavailable = (kind: string, error: unknown) => {
			throwIfAborted(ctx)
			if (!samples.unavailable.some((item) => item.kind === kind))
				samples.unavailable.push({ kind, error: error instanceof Error ? error.message : String(error) })
		}
		async function capture<T>(kind: 'memory' | 'timers', plugin: DiagnosticPlugin): Promise<Snapshot<T> | undefined> {
			try {
				throwIfAborted(ctx)
				const result = await plugin.execute(ctx, {})
				throwIfAborted(ctx)
				if (!result.success) throw new Error(result.error || `${kind} unavailable`)
				const source = result.data.source as string
				const subject = kind === 'memory' ? 'Memory' : 'Timeout'
				const at = source === 'agent' ? ctx.processInfo?.updatedAt[subject] : performance.now()
				if (typeof at !== 'number' || !Number.isFinite(at)) throw new Error('Agent sample timestamp is unavailable')
				const data = kind === 'timers' ? result.data.timers : { heapUsed: result.data.heapUsed, rss: result.data.rss }
				if (kind === 'timers') {
					if (!Array.isArray(data)) throw new Error('Timer snapshot is not an array')
				} else if (!Number.isFinite(data.heapUsed) || !Number.isFinite(data.rss))
					throw new Error('Memory snapshot must contain finite heapUsed and rss values')
				return {
					data,
					source,
					at,
					truncated: source === 'agent' && kind === 'timers' ? (ctx.processInfo?.truncated.timers ?? 0) : 0,
				}
			} catch (error) {
				unavailable(kind, error)
				return undefined
			}
		}
		ctx.onEvent?.({ type: 'progress', command: 'diagnose', message: '采集起始快照' })
		// 顺序读取共享上下文，保证每个快照保留自身对应的 Agent 时间戳及截断标记。
		const memoryStart = wanted('memory')
			? await capture<{ heapUsed: number; rss: number }>('memory', monitorMemoryPlugin)
			: undefined
		const timersStart = wanted('timers') ? await capture<TimerEvidence[]>('timers', timersPlugin) : undefined
		ctx.onEvent?.({ type: 'progress', command: 'diagnose', message: '观察指标变化并采集 CPU 证据' })
		async function cpu() {
			if (!wanted('cpu')) return
			try {
				const result = await cpuProfilePlugin.execute(ctx, { duration: String(duration), dir: options.dir })
				throwIfAborted(ctx)
				if (!result.success) throw new Error(result.error || 'CPU profile unavailable')
				const profile = JSON.parse(await readFile(result.data.filename, 'utf8')) as CpuProfile
				summarizeCpuProfile(profile)
				samples.cpu = { profile, filename: result.data.filename }
			} catch (error) {
				unavailable('cpu', error)
			}
		}
		// 即使 CPU 采样提前失败，内存和定时器仍需经历完整观察窗口；取消时等待采样清理完成。
		const outcomes = await Promise.allSettled([
			cpu(),
			memoryStart || timersStart ? wait(duration, ctx.signal) : Promise.resolve(),
		])
		throwIfAborted(ctx)
		for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason
		ctx.onEvent?.({ type: 'progress', command: 'diagnose', message: '采集结束快照并整理证据' })
		if (memoryStart) {
			const end = await capture<{ heapUsed: number; rss: number }>('memory', monitorMemoryPlugin)
			if (end) {
				try {
					samples.memory = {
						start: memoryStart.data,
						end: end.data,
						source: end.source,
						durationMs: elapsed(memoryStart, end),
					}
				} catch (error) {
					unavailable('memory', error)
				}
			}
		}
		if (timersStart) {
			const end = await capture<TimerEvidence[]>('timers', timersPlugin)
			if (end) {
				try {
					if (timersStart.truncated || end.truncated)
						throw new Error('Timer snapshots were truncated; exact timer growth cannot be established')
					samples.timers = {
						start: timersStart.data,
						end: end.data,
						source: end.source,
						durationMs: elapsed(timersStart, end),
					}
				} catch (error) {
					unavailable('timers', error)
				}
			}
		}
		samples.durationMs = performance.now() - started
		samples.completedAt = new Date().toISOString()
		const report = buildDiagnosisReport(samples)
		if (!report.observations.length)
			return {
				...fail(
					'No diagnostic evidence could be collected',
					'INSUFFICIENT_EVIDENCE',
					'Inspect unavailable components; enable SDK collection or increase the observation duration.'
				),
				data: report,
			}
		return ok(report)
	},
}

export type DiagnosisScenario = 'cpu' | 'memory' | 'timers' | 'all'
export interface CpuProfile {
	startTime: number
	endTime: number
	nodes: Array<{
		id: number
		callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number }
		children?: number[]
	}>
	samples?: number[]
	timeDeltas?: number[]
}
export interface CpuHotspot {
	functionName: string
	url: string
	line: number | null
	column: number | null
	selfTimeMs: number
	totalTimeMs: number
	sampleCount: number
	percent: number
}
export interface GrowthEvidence {
	durationMs: number
	start: number
	end: number
	delta: number
	ratePerSecond: number
	pattern: 'increasing' | 'decreasing' | 'stable'
	source: string
}
export interface TimerEvidence {
	id?: number
	name?: string
	stack?: string
	destroyed?: boolean
}
export interface DiagnosisObservation {
	kind: 'cpu' | 'memory' | 'timers'
	severity: 'info' | 'warning'
	summary: string
	evidence: unknown
	suggestion: string
	confidence: 'observed'
}
export interface DiagnosisReport {
	scenario: DiagnosisScenario
	durationMs: number
	startedAt: string
	completedAt: string
	cpu?: { hotspots: CpuHotspot[]; profileFilename: string; durationMs: number }
	memory?: { heapUsed: GrowthEvidence; rss: GrowthEvidence }
	timers?: {
		active: GrowthEvidence
		growingStacks: Array<{ stack: string; name: string; before: number; after: number; delta: number }>
	}
	observations: DiagnosisObservation[]
	unavailable: Array<{ kind: string; error: string }>
	artifacts: string[]
	source: string
}
export interface DiagnosisSamples {
	scenario: DiagnosisScenario
	startedAt: string
	completedAt: string
	durationMs: number
	cpu?: { profile: CpuProfile; filename: string }
	memory?: {
		start: { heapUsed: number; rss: number }
		end: { heapUsed: number; rss: number }
		durationMs: number
		source: string
	}
	timers?: { start: TimerEvidence[]; end: TimerEvidence[]; durationMs: number; source: string }
	unavailable: Array<{ kind: string; error: string }>
}

// CDP Profile 时间以微秒计，callFrame 行列从 0 开始；公开证据统一为毫秒和从 1 开始的位置。
export function summarizeCpuProfile(profile: CpuProfile): CpuHotspot[] {
	if (
		!profile ||
		!Number.isFinite(profile.startTime) ||
		!Number.isFinite(profile.endTime) ||
		profile.endTime <= profile.startTime ||
		!Array.isArray(profile.nodes)
	)
		throw new Error('Invalid CPU profile duration or nodes')
	const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
	const parent = new Map<number, number>()
	for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
	const samples = profile.samples ?? []
	const deltas = profile.timeDeltas ?? []
	if (samples.length !== deltas.length) throw new Error('CPU profile sample intervals are missing')
	const totals = new Map<number, { self: number; total: number; count: number }>()
	function entry(id: number) {
		let item = totals.get(id)
		if (!item) {
			item = { self: 0, total: 0, count: 0 }
			totals.set(id, item)
		}
		return item
	}
	for (const [index, id] of samples.entries()) {
		if (!nodes.has(id)) throw new Error(`CPU profile references unknown node ${id}`)
		const interval = deltas[index]
		if (!Number.isFinite(interval) || interval < 0) throw new Error('CPU profile sample interval must be non-negative')
		entry(id).self += interval
		entry(id).count++
		// 祖先累计时间包含子调用，self 时间仅属于被采样函数；防止损坏的 profile 循环阻塞诊断。
		const visited = new Set<number>()
		let ancestor: number | undefined = id
		while (ancestor !== undefined && !visited.has(ancestor)) {
			visited.add(ancestor)
			entry(ancestor).total += interval
			ancestor = parent.get(ancestor)
		}
	}
	return [...totals]
		.filter(
			([id, value]) => value.self > 0 && !['(root)', '(idle)'].includes(nodes.get(id)?.callFrame.functionName ?? '')
		)
		.map(([id, value]) => {
			const frame = nodes.get(id)?.callFrame
			if (!frame) throw new Error(`CPU profile references unknown node ${id}`)
			return {
				functionName: frame.functionName || '(anonymous)',
				url: frame.url,
				line: frame.lineNumber >= 0 ? frame.lineNumber + 1 : null,
				column: frame.columnNumber >= 0 ? frame.columnNumber + 1 : null,
				selfTimeMs: value.self / 1000,
				totalTimeMs: value.total / 1000,
				sampleCount: value.count,
				percent: (value.self / (profile.endTime - profile.startTime)) * 100,
			}
		})
		.sort(
			(a, b) =>
				b.selfTimeMs - a.selfTimeMs || b.totalTimeMs - a.totalTimeMs || a.functionName.localeCompare(b.functionName)
		)
		.slice(0, 10)
}

// 两点差分只证明采样窗口内的变化，不能作为持续泄漏或具体根因的结论。
export function measureGrowth(start: number, end: number, durationMs: number, source: string): GrowthEvidence {
	if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Growth samples must be finite numbers')
	if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Growth duration must be positive')
	const delta = end - start
	return {
		durationMs,
		start,
		end,
		delta,
		ratePerSecond: (delta / durationMs) * 1000,
		pattern: delta > 0 ? 'increasing' : delta < 0 ? 'decreasing' : 'stable',
		source,
	}
}

function stackCounts(timers: TimerEvidence[]) {
	const counts = new Map<string, { stack: string; name: string; count: number }>()
	for (const timer of timers.filter((item) => !item.destroyed)) {
		const stack = timer.stack || '未记录创建堆栈'
		const name = timer.name || 'unknown'
		const key = JSON.stringify([name, stack])
		const item = counts.get(key) ?? { name, stack, count: 0 }
		item.count++
		counts.set(key, item)
	}
	return counts
}

// 此结构同时供 JSON CLI 和 TUI 使用，视图不会单独推导或夸大诊断结论。
export function buildDiagnosisReport(samples: DiagnosisSamples): DiagnosisReport {
	const report: DiagnosisReport = {
		scenario: samples.scenario,
		durationMs: samples.durationMs,
		startedAt: samples.startedAt,
		completedAt: samples.completedAt,
		observations: [],
		unavailable: samples.unavailable,
		artifacts: [],
		source: '',
	}
	const sources = new Set<string>()
	if (samples.cpu) {
		const hotspots = summarizeCpuProfile(samples.cpu.profile)
		report.cpu = {
			hotspots,
			profileFilename: samples.cpu.filename,
			durationMs: (samples.cpu.profile.endTime - samples.cpu.profile.startTime) / 1000,
		}
		report.artifacts.push(samples.cpu.filename)
		sources.add('inspector')
		report.observations.push({
			kind: 'cpu',
			severity: 'info',
			summary: hotspots.length
				? `采样期间 ${hotspots[0].functionName} 的自身 CPU 样本时间最多`
				: '本次 Profile 未记录可归属的活跃函数样本',
			evidence: report.cpu,
			suggestion: '检查热点函数、文件与行号，结合代表性负载重复采样；采样热点不等于已确认根因。',
			confidence: 'observed',
		})
	}
	if (samples.memory) {
		const memory = samples.memory
		report.memory = {
			heapUsed: measureGrowth(memory.start.heapUsed, memory.end.heapUsed, memory.durationMs, memory.source),
			rss: measureGrowth(memory.start.rss, memory.end.rss, memory.durationMs, memory.source),
		}
		sources.add(memory.source)
		const growing = report.memory.heapUsed.delta > 0
		report.observations.push({
			kind: 'memory',
			severity: growing ? 'warning' : 'info',
			summary: growing ? '采样窗口内堆内存增加，尚未确认内存泄漏' : '采样窗口内堆内存未增加，不能据此排除泄漏',
			evidence: report.memory,
			suggestion: '在相同负载下延长观察，比较多次堆快照及对象保留路径；GC 和短时分配也会改变内存。',
			confidence: 'observed',
		})
	}
	if (samples.timers) {
		const timers = samples.timers
		const before = stackCounts(timers.start)
		const after = stackCounts(timers.end)
		const growingStacks = [...after]
			.map(([key, item]) => ({
				stack: item.stack,
				name: item.name,
				before: before.get(key)?.count ?? 0,
				after: item.count,
				delta: item.count - (before.get(key)?.count ?? 0),
			}))
			.filter((item) => item.delta > 0)
			.sort((a, b) => b.delta - a.delta)
			.slice(0, 10)
		const active = measureGrowth(
			timers.start.filter((item) => !item.destroyed).length,
			timers.end.filter((item) => !item.destroyed).length,
			timers.durationMs,
			timers.source
		)
		report.timers = { active, growingStacks }
		sources.add(timers.source)
		report.observations.push({
			kind: 'timers',
			severity: active.delta > 0 ? 'warning' : 'info',
			summary: active.delta > 0 ? '采样窗口内活跃定时器增加，尚未确认定时器泄漏' : '采样窗口内活跃定时器总数未增加',
			evidence: report.timers,
			suggestion: '查看增加的创建堆栈，检查请求结束或组件卸载时是否清理定时器，并在持续负载下重复观察。',
			confidence: 'observed',
		})
	}
	report.source = [...sources].join('+')
	return report
}

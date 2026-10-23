import stringWidth from 'string-width'
import type { OutputData } from '../core/types.js'
import type { NodeProcess } from '../shared/command.js'

export interface RecentError {
	timestamp?: number
	name: string
	message: string
}

export interface DashboardSample {
	at: number
	cpuAt?: number
	memoryAt?: number
	cpuIntervalMs?: number
	memoryIntervalMs?: number
	cpuSource?: string
	memorySource?: string
	cpuStale?: boolean
	memoryStale?: boolean
	cpu: number | null
	rss: number | null
	heapUsed: number | null
	heapTotal: number | null
	errors: number | null
	recentErrors?: RecentError[]
	timers: number | null
	source: string
	sdk: boolean
	agent: boolean
	ageMs: number
	stale: boolean
	validUntil?: number
	errorsStale?: boolean
	timersStale?: boolean
	errorsDropped?: number
	timersDropped?: number
	failure?: string
}

// 与 Agent 的快照契约保持结构兼容，视图不依赖 HTTP 或 Inspector 的实现。
export interface AgentObservation {
	metrics: { errors?: unknown[]; timers?: unknown[] } | null
	registeredSubjects: string[]
	updatedAt?: Record<string, number>
	intervals?: Record<string, number>
	truncated?: Record<string, unknown>
}

export interface Action {
	id: string
	command: string
	label: string
	purpose: string
	defaults: Record<string, string>
	preset?: Record<string, unknown>
	noTarget?: boolean
}

export const actions: Action[] = [
	{
		id: 'diagnose',
		command: 'diagnose',
		label: '组合诊断',
		purpose: '采集 CPU、内存和定时器证据，生成可追溯报告',
		defaults: { duration: '3000', dir: '.', timeout: '30000' },
	},
	{
		id: 'cpuprofile',
		command: 'cpuprofile',
		label: '采集 CPU Profile',
		purpose: '定位采样期间实际消耗 CPU 的调用栈',
		defaults: { duration: '10000', dir: '.', timeout: '30000' },
	},
	{
		id: 'memory',
		command: 'memory',
		label: '查看内存详情',
		purpose: '查看 V8 堆与进程内存，一次快照不能确认内存泄漏',
		defaults: { timeout: '30000' },
	},
	{
		id: 'errors',
		command: 'errors',
		label: '查看最近错误',
		purpose: '读取 SDK 采集的异常及堆栈；需要 SDK 和 Agent',
		defaults: { timeout: '30000' },
	},
	{
		id: 'timers',
		command: 'timers',
		label: '查看活跃定时器',
		purpose: '读取当前定时器及创建位置；需要 SDK 和 Agent',
		defaults: { timeout: '30000' },
	},
	{
		id: 'report',
		command: 'report',
		label: '保存进程报告',
		purpose: '保存 Node.js 线程、资源、运行环境等诊断信息',
		defaults: { dir: '.', timeout: '30000' },
	},
	{
		id: 'heapsnapshot',
		command: 'heapsnapshot',
		label: '保存堆快照',
		purpose: '分析对象保留关系；采集期间目标进程可能暂停',
		defaults: { dir: '.', timeout: '30000' },
	},
	{
		id: 'run-code',
		command: 'run-code',
		label: '运行调试代码',
		purpose: '代码在目标进程执行；仅用于自己的开发或调试进程',
		defaults: { code: '', file: '', timeout: '30000' },
	},
	{
		id: 'history',
		command: 'history',
		label: '查看诊断记录',
		purpose: '查看本机保存的历史，输入记录 ID 可查看详情',
		defaults: { id: '', timeout: '30000' },
		noTarget: true,
	},
	{
		id: 'compare',
		command: 'history',
		label: '比较两次结果',
		purpose: '比较同类诊断的指标，输入两个记录 ID',
		defaults: { compare: '', timeout: '30000' },
		noTarget: true,
	},
	{
		id: 'artifacts',
		command: 'history',
		label: '查看诊断文件',
		purpose: '查看 Profile、堆快照及报告的绝对路径',
		defaults: { timeout: '30000' },
		preset: { artifacts: true },
		noTarget: true,
	},
]

export const fieldLabels: Record<string, string> = {
	duration: '采集时长 (ms)',
	dir: '输出目录',
	timeout: '总超时 (ms)',
	code: 'JS 代码',
	file: 'JS 文件路径',
	id: '记录 ID（空为列表）',
	compare: '记录 ID1,ID2',
}

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function age(info: AgentObservation | null, subject: string, now: number) {
	const key =
		({ cpu: 'CPU', memory: 'Memory', errors: 'JSError', timers: 'Timeout' } as Record<string, string>)[subject] ??
		subject
	const updated = info?.updatedAt?.[key] ?? info?.updatedAt?.[subject]
	return typeof updated === 'number' ? Math.max(0, now - updated) : null
}

function stale(info: AgentObservation | null, subject: string, now: number) {
	const sampleAge = age(info, subject, now)
	const key =
		({ cpu: 'CPU', memory: 'Memory', errors: 'JSError', timers: 'Timeout' } as Record<string, string>)[subject] ??
		subject
	return sampleAge === null || sampleAge > (info?.intervals?.[key] ?? info?.intervals?.[subject] ?? 1000) * 3
}

export function buildSample(
	cpu: OutputData,
	memory: OutputData,
	info: AgentObservation | null,
	now: number
): DashboardSample {
	const cpuData = cpu.success && cpu.data && typeof cpu.data === 'object' ? cpu.data : {}
	const memoryData = memory.success && memory.data && typeof memory.data === 'object' ? memory.data : {}
	const sources = [...new Set([cpuData.source, memoryData.source].filter(Boolean))]
	const metricMeta = (data: Record<string, unknown>, subject: 'CPU' | 'Memory', success: boolean) => {
		// Inspector 回退是独立的新采样，不能继承旧 SDK 缓存的采集时间。
		const sampledAt =
			data.sampledAt ??
			(data.source === 'agent' ? (info?.updatedAt?.[subject] ?? info?.updatedAt?.[subject.toLowerCase()]) : undefined)
		const interval =
			data.interval ??
			(data.source === 'agent'
				? (info?.intervals?.[subject] ?? info?.intervals?.[subject.toLowerCase()])
				: undefined) ??
			1000
		const validInterval = typeof interval === 'number' && Number.isFinite(interval) && interval > 0 ? interval : 1000
		const sampledTime = typeof sampledAt === 'number' && Number.isFinite(sampledAt) ? sampledAt : undefined
		return {
			source: data.source,
			at: data.source === 'agent' ? sampledTime : success ? (sampledTime ?? now) : undefined,
			interval: validInterval,
			stale: data.source === 'agent' && (sampledTime === undefined || now - sampledTime > validInterval * 3),
		}
	}
	const cpuMeta = metricMeta(cpuData, 'CPU', cpu.success)
	const memoryMeta = metricMeta(memoryData, 'Memory', memory.success)
	const agentMetrics = [cpuMeta, memoryMeta].filter((meta) => meta.source === 'agent')
	const ages = agentMetrics.map((meta) => (meta.at === undefined ? 0 : Math.max(0, now - meta.at)))
	const errorsStale = info?.metrics?.errors !== undefined && stale(info, 'errors', now)
	const timersStale = info?.metrics?.timers !== undefined && stale(info, 'timers', now)
	return {
		at: now,
		cpuAt: cpuMeta.at,
		memoryAt: memoryMeta.at,
		// 两类采集器可能使用不同来源和频率，趋势图不能用一个过期标记截断所有指标。
		cpuIntervalMs: cpuMeta.interval,
		memoryIntervalMs: memoryMeta.interval,
		cpuSource: typeof cpuMeta.source === 'string' ? cpuMeta.source : undefined,
		memorySource: typeof memoryMeta.source === 'string' ? memoryMeta.source : undefined,
		cpuStale: !cpu.success || cpuMeta.stale,
		memoryStale: !memory.success || memoryMeta.stale,
		cpu: numberOrNull(cpuData.cpuPercent),
		rss: numberOrNull(memoryData.rss),
		heapUsed: numberOrNull(memoryData.heapUsed),
		heapTotal: numberOrNull(memoryData.heapTotal),
		errors: Array.isArray(info?.metrics?.errors) ? info.metrics.errors.length : null,
		recentErrors: Array.isArray(info?.metrics?.errors)
			? info.metrics.errors
					.slice(-5)
					.reverse()
					.map((value) => {
						const error = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
						return {
							timestamp: typeof error.timestamp === 'number' ? error.timestamp : undefined,
							name: typeof error.name === 'string' ? error.name : '未记录类型',
							message: typeof error.message === 'string' ? error.message : '未记录消息',
						}
					})
			: [],
		timers: Array.isArray(info?.metrics?.timers) ? info.metrics.timers.length : null,
		source: sources.join('+') || '暂无数据',
		sdk: Boolean(info?.registeredSubjects.length),
		agent: Boolean(info),
		ageMs: Math.max(0, ...ages),
		stale: agentMetrics.some((meta) => meta.stale),
		validUntil: Math.min(
			...(sources.includes('inspector') || !agentMetrics.length ? [now + 6000] : []),
			...agentMetrics.map((meta) => (meta.at ?? now) + meta.interval * 3)
		),
		errorsStale,
		timersStale,
		errorsDropped: Number(info?.truncated?.errors) || 0,
		timersDropped: Number(info?.truncated?.timers) || 0,
		failure:
			[cpu, memory]
				.filter((result) => !result.success)
				.map((result) => `${result.command}: ${result.error ?? '采集失败'}`)
				.join('；') || undefined,
	}
}

export function appendSample(history: DashboardSample[], next: DashboardSample): DashboardSample[] {
	// 仅保存真实采样；时间回拨时丢弃未来样本，防止图表假装时间仍然单调。
	const withinWindow = history.filter((sample) => sample.at <= next.at && sample.at > next.at - 60000)
	const previous = withinWindow.at(-1)
	// HTTP 查询不等于新采样；相同 SDK 时间戳只更新当前状态，不能制造连续高 CPU 证据。
	if (
		previous &&
		(next.cpuAt !== undefined || next.memoryAt !== undefined) &&
		next.source === previous.source &&
		next.cpuAt === previous.cpuAt &&
		next.memoryAt === previous.memoryAt
	) {
		return [...withinWindow.slice(0, -1), next]
	}
	// 最小刷新间隔为 100ms，600 个真实样本仍能覆盖完整一分钟且保持内存有界。
	return [...withinWindow, next].slice(-600)
}

export function chartValues(
	history: DashboardSample[],
	metric: 'cpu' | 'rss',
	now: number,
	width: number
): (number | null)[] {
	const size = Math.max(1, Math.min(60, Math.floor(width)))
	const bins: (number | null)[] = Array.from({ length: size }, () => null)
	const span = 60000
	const binTimes = Array.from({ length: size }, () => -Infinity)
	for (const sample of history) {
		const sampledAt = metric === 'cpu' ? sample.cpuAt : sample.memoryAt
		const at = sampledAt ?? sample.at
		if (at <= now - span || at > now) continue
		const index = size - 1 - Math.floor(((now - at) / span) * size)
		if (index >= 0 && at >= binTimes[index]) {
			bins[index] = sample.stale && sampledAt === undefined ? null : sample[metric]
			binTimes[index] = at
		}
	}
	return bins
}

export function chart(history: DashboardSample[], metric: 'cpu' | 'rss', now: number, width: number): string {
	const bins = chartValues(history, metric, now, width)
	const maximum = Math.max(metric === 'cpu' ? 100 : 1, ...bins.filter((value): value is number => value !== null))
	const blocks = '▁▂▃▄▅▆▇█'
	return bins.map((value) => (value === null ? '·' : blocks[Math.min(7, Math.floor((value / maximum) * 7))])).join('')
}

export function isExpired(sample: DashboardSample, now: number) {
	return sample.stale || now > (sample.validUntil ?? sample.at + 6000)
}

// CPU 与内存可以不同频率，观察和均值只计入各个独立 CPU 采样时间点。
export function cpuSamples(history: DashboardSample[]): DashboardSample[] {
	return [...new Map(history.map((sample) => [sample.cpuAt ?? sample.at, sample])).values()].sort(
		(a, b) => (a.cpuAt ?? a.at) - (b.cpuAt ?? b.at)
	)
}

export function observation(history: DashboardSample[], now = history.at(-1)?.at ?? Date.now()) {
	const latest = history.at(-1)
	if (!latest || (latest.cpu === null && latest.rss === null))
		return { title: '等待有效采样', detail: '暂无数据不等于 0；等待连接或查看采集错误。', action: 'diagnose' }
	if (isExpired(latest, now))
		return {
			title: '样本已过期',
			detail: '旧样本不能代表当前进程，检查 SDK、Agent 及目标存活状态。',
			action: 'diagnose',
		}
	const lastThree = cpuSamples(history).slice(-3)
	if (lastThree.length === 3 && lastThree.every((item) => !item.stale && item.cpu !== null && item.cpu >= 80))
		return {
			title: 'CPU 使用率连续偏高',
			detail: '最近 3 次有效采样均 ≥80%，尚不能确定具体函数，需要 CPU Profile 证据。',
			action: 'cpuprofile',
		}
	if (latest.errors !== null && latest.errors > 0 && !latest.errorsStale)
		return {
			title: `采集到 ${latest.errors} 条最近错误`,
			detail: '错误可能与当前症状相关；展开堆栈并结合时间判断。',
			action: 'errors',
		}
	const first = history.find((item) => item.heapUsed !== null && !item.stale)
	if (first?.heapUsed && latest.heapUsed && history.length >= 5 && latest.heapUsed > first.heapUsed * 1.2)
		return {
			title: '窗口内堆内存有所增长',
			detail: '短时增长也可能来自正常分配或 GC 周期，需继续采样或分析堆快照。',
			action: 'diagnose',
		}
	return {
		title: '已取得进程采样',
		detail: '当前快照不足以确认根因；可按症状选择证据，或运行组合诊断。',
		action: 'diagnose',
	}
}

export function validateParameters(
	command: string,
	values: Record<string, string>
): { error?: string; options?: Record<string, unknown>; timeout?: number } {
	const timeout = Number(values.timeout)
	if (!Number.isSafeInteger(timeout) || timeout <= 0) return { error: '超时必须为正整数毫秒' }
	const options: Record<string, unknown> = {}
	if ('duration' in values) {
		const duration = Number(values.duration)
		if (!Number.isSafeInteger(duration) || duration <= 0) return { error: '采集时长必须为正整数毫秒' }
		if (duration >= timeout) return { error: '总超时必须大于采集时长，预留连接与保存时间' }
		options.duration = duration
	}
	if (command === 'run-code') {
		if (values.code?.trim() && values.file?.trim()) return { error: '不能同时提供代码和文件路径' }
		if (!values.code?.trim() && !values.file?.trim()) return { error: '请提供 JS 代码或文件路径' }
	}
	if ('compare' in values && values.compare.split(',').filter((value) => value.trim()).length !== 2)
		return { error: '比较需要两个记录 ID，用英文逗号分隔' }
	for (const [key, value] of Object.entries(values)) {
		if (key !== 'timeout' && key !== 'duration' && value.trim()) options[key] = value.trim()
	}
	return { options, timeout }
}

export function resultLines(result: OutputData, expanded: boolean): string[] {
	const failure = !result.success
		? [
				result.error ?? '诊断失败',
				...(result.errorCode ? [`错误码: ${result.errorCode}`] : []),
				...(result.suggestion ? [`下一步: ${result.suggestion}`] : []),
			]
		: []
	if (result.data === undefined) return failure.length ? failure : ['操作已完成，无返回数据']
	// 清理失败仍可能保留已保存的产物；保留业务值及完整结构，不能用失败状态丢弃有效数据。
	const json = JSON.stringify(
		result.data,
		(key, value) => (!expanded && key === 'stack' ? '[按 X 展开堆栈]' : value),
		2
	)
	return [...failure, ...(json ?? String(result.data)).split('\n')]
}

export function filterProcesses(processes: NodeProcess[], query: string) {
	const term = query.toLocaleLowerCase().trim()
	return processes.filter((proc) => `${proc.pid} ${proc.command}`.toLocaleLowerCase().includes(term))
}

export function clip(text: string, width: number) {
	if (width <= 0) return ''
	if (stringWidth(text) <= width) return text
	let value = ''
	for (const character of text) {
		if (stringWidth(value + character) > width - 1) break
		value += character
	}
	return `${value}…`
}

export function viewportLines(lines: string[], offset: number, count: number, width: number): string[] {
	const start = Math.max(0, Math.min(Math.max(0, lines.length - count), offset))
	return lines.slice(start, start + count).map((line) => clip(line, width))
}

export function formatMetric(value: number | null | undefined, unit = '') {
	if (value === null || value === undefined || !Number.isFinite(value)) return '暂无数据'
	return `${value.toFixed(1)}${unit}`
}

export function processName(proc: NodeProcess) {
	const parts = proc.command.split(/\s+/)
	return (
		parts
			.find((part) => /\.[cm]?js$|\.[cm]?ts$/.test(part))
			?.split(/[\\/]/)
			.at(-1) ??
		parts.at(-1)?.split(/[\\/]/).at(-1) ??
		'Node.js'
	)
}

export function wrapLines(lines: string[], width: number): string[] {
	const limit = Math.max(2, width)
	return lines.flatMap((line) => {
		const parts: string[] = []
		let current = ''
		for (const character of line) {
			if (stringWidth(current + character) > limit) {
				parts.push(current)
				current = ''
			}
			current += character
		}
		parts.push(current)
		return parts
	})
}

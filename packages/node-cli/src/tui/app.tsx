import { Box, Text, useApp, useInput, useStdout } from 'ink'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { TuiController, TuiState } from './controller.js'
import {
	actions,
	chart,
	chartValues,
	clip,
	cpuSamples,
	fieldLabels,
	filterProcesses,
	formatMetric,
	isExpired,
	observation,
	processName,
	resultLines,
	wrapLines,
} from './model.js'

interface Line {
	text: string
	tone?: 'accent' | 'warning' | 'danger' | 'muted' | 'good'
	bold?: boolean
	selected?: boolean
}
const tones = { accent: 'cyan', warning: 'yellow', danger: 'red', muted: '#aab4c0', good: 'green' }
const tabs = [
	{ id: 'overview', label: '总览' },
	{ id: 'cpu', label: 'CPU' },
	{ id: 'memory', label: '内存' },
	{ id: 'errors', label: '错误' },
	{ id: 'timers', label: '定时器' },
	{ id: 'artifacts', label: '产物' },
]
const mib = (value: number | null | undefined) => formatMetric(value == null ? null : value / 1024 / 1024, ' MiB')
const count = (value: number | null | undefined) => (value == null ? '暂无数据' : String(value))

function helpLines(): Line[] {
	return [
		{ text: '键盘帮助', tone: 'accent', bold: true },
		{ text: '↑ ↓       选择进程、任务或参数字段；在结果和产物区域滚动' },
		{ text: 'Enter     确认选择；在参数页执行操作' },
		{ text: '← →       切换总览、CPU、内存、错误、定时器与产物页签' },
		{ text: 'Tab       切换指标、任务、参数字段与产物区域' },
		{ text: 'Esc       返回上一步；运行期间请求取消等待' },
		{ text: 'Ctrl+C    请求取消、清理连接并退出' },
		{ text: '/         搜索进程；Enter 结束输入，再 Enter 选择' },
		{ text: 'R         刷新进程；在结果页重新执行' },
		{ text: 'X         展开完整启动命令或结果中的错误堆栈' },
		{ text: 'P         切换目标进程；H 查看诊断记录' },
		{ text: 'PgUp/PgDn 滚动长内容；指标区域也可用 J/K 逐行滚动' },
		{ text: 'Ctrl+U    清空当前参数；Backspace 删除末尾字符' },
		{ text: '?         关闭或打开帮助' },
		{ text: '' },
		{ text: 'CPU 100% 约等于一个逻辑 CPU 的时间；多核可超过 100%。' },
		{ text: 'RSS 为进程驻留内存；Heap 为 V8 JS 堆，不等于进程全部内存。' },
		{ text: '图中 · 是缺失或过期样本，不能解释为 0。图表按实际峰值缩放。' },
		{ text: '错误和定时器需要 SDK 与 Agent；未连接时显示“暂无数据”。' },
		{ text: '取消只停止本次等待，部分目标操作可能仍在完成。' },
	]
}

function resultSummary(state: TuiState): Line[] {
	const result = state.result
	if (!result) return [{ text: '暂无执行结果', tone: 'muted' }]
	const lines: Line[] = [
		{
			text: `${result.success ? '完成' : '未完成'} · ${actions[state.actionIndex].label}`,
			tone: result.success ? 'good' : 'danger',
			bold: true,
		},
	]
	if (state.elapsedMs) lines.push({ text: `本次用时 ${(state.elapsedMs / 1000).toFixed(1)} 秒`, tone: 'muted' })
	const data = result.data
	// 采集成功后清理 Inspector 仍可能失败，已保存文件的路径和查看方式必须继续可见。
	if (data && typeof data === 'object') {
		if (data.source) lines.push({ text: `数据源: ${data.source}`, tone: 'muted' })
		if (result.command === 'memory' || result.command === 'monitor-memory') {
			const memory = data.memory ?? data
			lines.push({
				text: `RSS ${mib(memory.rss)}  |  Heap ${mib(memory.heapUsed)} / ${mib(memory.heapTotal)}`,
				bold: true,
			})
		}
		if (Array.isArray(data.errors)) lines.push({ text: `最近错误: ${data.errors.length} 条`, bold: true })
		if (Array.isArray(data.timers)) lines.push({ text: `活跃定时器: ${data.timers.length} 个`, bold: true })
		if (Array.isArray(data.observations)) {
			for (const item of data.observations) {
				lines.push({
					text: `观察 [${item.kind}]: ${item.summary}`,
					tone: item.severity === 'warning' ? 'warning' : 'accent',
					bold: true,
				})
				lines.push({ text: `建议: ${item.suggestion}` })
			}
			for (const item of data.unavailable ?? [])
				lines.push({ text: `未取得 ${item.kind} 证据: ${item.error}`, tone: 'warning' })
		}
		if (data.cpu?.hotspots?.length) {
			lines.push({ text: 'CPU 热点（自身样本时间）', tone: 'accent', bold: true })
			for (const item of data.cpu.hotspots)
				lines.push({
					text: `${item.functionName}  ${Number(item.percent).toFixed(1)}%  ${item.url}:${item.line ?? '?'}`,
				})
		}
		if (data.memory?.heapUsed?.delta !== undefined)
			lines.push({ text: `Heap 变化 ${mib(data.memory.heapUsed.delta)}；RSS 变化 ${mib(data.memory.rss.delta)}` })
		if (data.timers?.active?.delta !== undefined)
			lines.push({
				text: `活跃定时器: ${data.timers.active.start} → ${data.timers.active.end}（变化 ${data.timers.active.delta}）`,
			})
		if (data.filename) lines.push({ text: `文件: ${data.filename}`, tone: 'accent' })
		for (const filename of Array.isArray(data.artifacts) ? data.artifacts : [])
			lines.push({ text: `文件: ${typeof filename === 'string' ? filename : filename.path}`, tone: 'accent' })
		if (data.filename?.endsWith('.cpuprofile') || data.cpu?.profileFilename)
			lines.push({ text: '查看方式: Chrome DevTools → Performance → Load profile', tone: 'muted' })
		if (data.filename?.endsWith('.heapsnapshot'))
			lines.push({ text: '查看方式: Chrome DevTools → Memory → Load', tone: 'muted' })
		if (data.filename?.endsWith('.json')) lines.push({ text: '查看方式: 用编辑器打开 JSON 报告', tone: 'muted' })
		if (Array.isArray(data.records)) {
			lines.push({ text: `诊断记录: ${data.records.length} 条；选择“查看诊断记录”并输入 ID 查看详情`, tone: 'accent' })
			for (const record of data.records) {
				lines.push({
					text: `${record.timestamp}  PID ${record.pid ?? '-'}  ${record.command}  ${record.success ? '完成' : '失败'}`,
				})
				lines.push({ text: `ID: ${record.id}`, tone: 'muted' })
			}
		}
		if (data.comparison) {
			lines.push({ text: '两次诊断差异', tone: 'accent', bold: true })
			for (const delta of data.comparison.deltas ?? [])
				lines.push({ text: `${delta.metric}: ${delta.before} → ${delta.after}（变化 ${delta.delta}）` })
		}
		for (const warning of data.warnings ?? []) lines.push({ text: `记录提示: ${warning}`, tone: 'warning' })
	}
	lines.push({ text: '' }, { text: `完整结果 · X ${state.expanded ? '折叠' : '展开'}堆栈 · ↑↓ 滚动`, tone: 'muted' })
	lines.push(
		...resultLines(result, state.expanded).map((text): Line => ({ text, tone: result.success ? undefined : 'danger' }))
	)
	return lines
}

function processLines(state: TuiState, width: number): Line[] {
	const processes = filterProcesses(state.processes, state.query)
	const selected = processes[state.processIndex]
	const lines: Line[] = [
		{ text: '选择要诊断的 Node.js 进程', tone: 'accent', bold: true },
		{
			text: `${state.searching ? '›' : '/'} 搜索 PID 或命令: ${state.query}${state.searching ? '▏' : ''}`,
			tone: state.searching ? 'accent' : 'muted',
		},
		{
			text: state.loading ? '正在刷新进程…' : `共 ${processes.length} 个匹配进程 · R 刷新 · X 展开命令 · H 历史`,
			tone: 'muted',
		},
	]
	if (state.error) lines.push({ text: state.error, tone: 'danger' })
	if (!processes.length && !state.loading)
		lines.push({
			text: state.query ? '没有匹配进程；清空搜索或按 R 刷新。' : '没有可选进程；启动自己的 Node.js 应用后按 R 刷新。',
			tone: 'warning',
		})
	if (state.expanded && selected)
		lines.push(
			{ text: '完整启动命令', tone: 'accent', selected: true },
			...wrapLines([selected.command], width).map((text) => ({ text })),
			{ text: '' }
		)
	for (const [index, proc] of processes.entries())
		lines.push({
			text: `${index === state.processIndex ? '›' : ' '} ${String(proc.pid).padEnd(7)} ${processName(proc)}  ${clip(proc.command, Math.max(10, width - 25))}`,
			tone: index === state.processIndex ? 'accent' : undefined,
			selected: index === state.processIndex && !state.expanded,
		})
	return lines
}

function artifactLines(state: TuiState, full = true): Line[] {
	const records = state.artifacts ?? []
	const lines: Line[] = [{ text: '最近产物 · 时间 / 类型 / 来源 / 绝对路径', tone: 'accent', bold: true }]
	if (state.artifactWarning) lines.push({ text: `记录提示: ${state.artifactWarning}`, tone: 'warning' })
	if (!records.length) lines.push({ text: '暂无诊断文件；运行任务后显示实际保存的产物。', tone: 'muted' })
	for (const item of records.slice(0, full ? 100 : 2))
		lines.push({
			text: `${item.timestamp.replace('T', ' ').replace('.000Z', 'Z')}  ${item.command}  ${item.source}  ${item.path}`,
		})
	if (full)
		lines.push({ text: '' }, { text: 'H 查看历史详情；任务列表中可比较两次结果或列出全部文件。', tone: 'muted' })
	return lines
}

function errorTable(state: TuiState): Line[] {
	const sample = state.samples.at(-1)
	const lines: Line[] = [
		{ text: `最近错误（最近 5 条）${sample?.errorsStale ? ' · 旧样本' : ''}`, tone: 'accent', bold: true },
	]
	if (sample?.errors === null || sample?.errors === undefined)
		return [...lines, { text: '暂无错误数据；需要 SDK 与 Agent。', tone: 'muted' }]
	if (!sample.recentErrors?.length) return [...lines, { text: '暂无采集错误（0 条）', tone: 'muted' }]
	lines.push({ text: '时间        类型         消息', tone: 'muted' })
	for (const error of sample.recentErrors)
		lines.push({
			text: `${error.timestamp === undefined ? '未记录时间' : new Date(error.timestamp).toISOString().slice(11, 19)}  ${error.name}  ${error.message}`,
			tone: 'danger',
		})
	return lines
}

function cpuGraph(state: TuiState, now: number, width: number, height = 4): Line[] {
	const history = state.samples
	const values = cpuSamples(history)
		.filter((sample) => (sample.cpuAt ?? sample.at) > now - 60000)
		.flatMap((sample) => (sample.cpu === null ? [] : [sample.cpu]))
	const maximum = Math.max(100, ...values)
	const points = chartValues(history, 'cpu', now, Math.max(8, Math.min(60, width - 9)))
	const rows: Line[] = [
		{
			text: `CPU 使用率（最近 60 秒） ${values.length ? `样本均值 ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)}%` : '等待有效样本'}`,
			tone: 'accent',
		},
	]
	for (let row = height - 1; row >= 0; row--) {
		const label = `${Math.round((maximum * row) / Math.max(1, height - 1))}%`.padStart(5)
		rows.push({
			text: `${label} │${points
				.map((value) => (value === null ? ' ' : (value / maximum) * (height - 1) >= row ? '•' : ' '))
				.join('')}`,
			tone: 'accent',
		})
	}
	rows.push({ text: `      60s${' '.repeat(Math.max(1, points.length - 9))}现在`, tone: 'muted' })
	return rows
}

function overviewLines(state: TuiState, now: number, width: number, height: number): Line[] {
	const sample = state.samples.at(-1)
	const observed = observation(state.samples, now)
	const lines: Line[] = [
		{ text: '进程状态', tone: 'accent', bold: true },
		{
			text: `CPU ${formatMetric(sample?.cpu, '%')}  RSS ${mib(sample?.rss)}  Heap ${mib(sample?.heapUsed)} / ${mib(sample?.heapTotal)}`,
			bold: true,
		},
		{
			text: `最近错误 ${count(sample?.errors)}${sample?.errorsStale ? '（过期）' : ''}  活跃定时器 ${count(sample?.timers)}${sample?.timersStale ? '（过期）' : ''}`,
		},
		{
			text: clip(
				state.step === 'running'
					? '任务执行中；状态刷新暂停，当前指标为采集前快照。'
					: sample?.source === 'inspector' && !sample.sdk
						? '仅 Inspector：CPU / 内存可用；错误 / 定时器需接入 SDK 并连接 Agent。'
						: `当前观察 · ${observed.title}`,
				width
			),
			tone: sample && isExpired(sample, now) ? 'warning' : 'muted',
		},
	]
	if (sample?.failure) lines.push({ text: clip(`采集提示: ${sample.failure}`, width), tone: 'warning' })
	if (sample?.errorsDropped || sample?.timersDropped)
		lines.push({
			text: `记录截断: 错误 ${sample.errorsDropped ?? 0} / 定时器 ${sample.timersDropped ?? 0}`,
			tone: 'warning',
		})
	const tab = state.workspaceTab ?? 'overview'
	if (tab === 'cpu')
		return [
			...lines,
			...cpuGraph(state, now, width, Math.max(3, Math.min(7, height - 10))),
			{ text: observed.detail },
			{ text: 'CPU 100% 约为一个逻辑 CPU；多核可超过 100%。', tone: 'muted' },
			{ text: 'Enter 设置 CPU Profile；具体函数需要采样证据。', tone: 'muted' },
		]
	if (tab === 'memory')
		return [
			...lines,
			{ text: 'RSS 趋势（最近 60 秒）', tone: 'accent' },
			{ text: chart(state.samples, 'rss', now, Math.min(60, width)) },
			{ text: 'RSS 为进程驻留内存；Heap 为 V8 JS 堆。短时增加不能确认泄漏。', tone: 'muted' },
			{ text: 'Enter 查看内存详情；可从任务列表保存堆快照。', tone: 'muted' },
		]
	if (tab === 'errors')
		return [...errorTable(state), { text: 'Enter 获取完整错误列表；结果中 X 展开堆栈。', tone: 'muted' }]
	if (tab === 'timers')
		return [
			...lines,
			{ text: '定时器数据来自 SDK 当前快照，数量增加不能单独证明泄漏。' },
			{ text: 'Enter 获取完整定时器列表与创建堆栈。', tone: 'muted' },
		]
	if (tab === 'artifacts') return artifactLines(state)
	return [
		...lines,
		...cpuGraph(state, now, width, height >= 22 ? 6 : 3),
		...errorTable(state),
		{ text: `当前任务: ${actions[state.actionIndex].label} · Tab 切换区域`, tone: 'muted' },
	]
}

function taskLines(state: TuiState): Line[] {
	const area = state.workspaceArea ?? 'overview'
	const action = actions[state.actionIndex]
	const fields = Object.keys(state.fields).length ? state.fields : action.defaults
	const lines: Line[] = [
		{ text: '诊断任务', tone: 'accent', bold: true },
		{
			text: area === 'parameters' ? '↑↓ 切换字段 · Tab 下一字段' : '↑↓ 选择任务 · Enter 设置参数',
			tone: 'muted',
		},
	]
	const start = Math.max(0, Math.min(actions.length - 4, state.actionIndex - 1))
	for (let index = start; index < Math.min(actions.length, start + 4); index++)
		lines.push({
			text: `${index === state.actionIndex ? '›' : ' '} ${actions[index].label}`,
			selected: area === 'tasks' && index === state.actionIndex,
			tone: index === state.actionIndex ? 'accent' : undefined,
		})
	lines.push({ text: '参数设置', tone: 'accent', bold: true })
	for (const [index, [key, value]] of Object.entries(fields).entries())
		lines.push({
			text: `${area === 'parameters' && index === state.fieldIndex ? '›' : ' '} ${fieldLabels[key] ?? key}: ${value}${area === 'parameters' && index === state.fieldIndex ? '▏' : ''}`,
			selected: area === 'parameters' && index === state.fieldIndex,
			tone: area === 'parameters' && index === state.fieldIndex ? 'accent' : undefined,
		})
	lines.push({
		text:
			state.cancelling || state.closing
				? '[ 正在清理，请稍候 ]'
				: state.step === 'running'
					? '[ 采集中 · Esc 请求取消 ]'
					: '[ Enter 开始采集 ]',
		tone: 'accent',
		bold: true,
	})
	if (state.error) lines.push({ text: `无法执行: ${state.error}`, tone: 'danger' })
	if (state.step === 'running' || state.closing)
		lines.push(
			{ text: state.progress || '准备连接', tone: 'warning' },
			{ text: `已用 ${(state.elapsedMs / 1000).toFixed(1)}s / 超时 ${Number(fields.timeout) / 1000}s` },
			{ text: '取消等待不代表目标操作已结束。', tone: 'muted' }
		)
	else
		lines.push({
			text: state.result ? `任务状态: ${state.result.success ? '完成' : '未完成'}` : '任务状态: 等待执行',
			tone: state.result && !state.result.success ? 'warning' : 'muted',
		})
	lines.push({ text: action.purpose, tone: 'muted' })
	return lines
}

function wrapped(lines: Line[], width: number): Line[] {
	return lines.flatMap((line) => wrapLines([line.text], width).map((text) => ({ ...line, text })))
}

function viewport(lines: Line[], height: number, state: TuiState, focused = true) {
	const selected = focused ? lines.findIndex((line) => line.selected) : -1
	const auto = Math.max(0, selected - height + 1)
	const max = Math.max(0, lines.length - height)
	const offset = Math.min(max, focused && (state.manualScroll || state.scroll > 0) ? state.scroll : auto)
	return { visible: lines.slice(offset, offset + height), offset, max }
}

function focusedPane(state: TuiState, columns: number, rows: number, now: number) {
	const wide = columns >= 120
	const area = state.workspaceArea ?? 'overview'
	const special = state.step === 'select' || state.help
	const width =
		special || !wide
			? columns - 4
			: area === 'tasks' || area === 'parameters'
				? columns - Math.floor(((columns - 1) * 2) / 3) - 5
				: Math.floor(((columns - 1) * 2) / 3) - 4
	const height = rows - (wide && !special ? 13 : 8)
	let lines: Line[]
	if (state.help) lines = helpLines()
	else if (state.step === 'select') lines = processLines(state, width)
	else if (state.step === 'running' || state.closing) lines = taskLines(state)
	else if (state.step === 'result' && area === 'overview') lines = resultSummary(state)
	else if (area === 'tasks' || area === 'parameters') lines = taskLines(state)
	else if (area === 'artifacts') lines = artifactLines(state)
	else lines = overviewLines(state, now, width, height)
	return { lines: wrapped(lines, width), width, height }
}

export interface ViewProps {
	state: TuiState
	columns: number
	rows: number
	now: number
	noColor?: boolean
}
export function TuiView({ state, columns, rows, now, noColor }: ViewProps) {
	if (columns < 70 || rows < 20)
		return (
			<Box flexDirection='column' width={Math.max(1, columns)}>
				<Text>终端窗口过小</Text>
				<Text>请调整到至少 70×20，推荐 80×24 或 120×36。</Text>
				<Text>Ctrl+C 退出；也可使用普通 CLI --json。</Text>
			</Box>
		)
	const color = (tone: Line['tone']) => (!noColor && tone ? tones[tone] : undefined)
	const wide = columns >= 120
	const sample = state.samples.at(-1)
	const expired = sample ? isExpired(sample, now) : false
	const age = sample ? sample.ageMs + Math.max(0, now - sample.at) : null
	const area = state.workspaceArea ?? 'overview'
	const special = state.step === 'select' || state.help
	const mainHeight = rows - (wide && !special ? 11 : 6)
	const innerHeight = mainHeight - 2
	const leftWidth = Math.floor(((columns - 1) * 2) / 3)
	const rightWidth = columns - leftWidth - 1
	const focused = focusedPane(state, columns, rows, now)
	const visible = viewport(focused.lines, focused.height, state)
	const renderLines = (lines: Line[], width: number, height: number, active: boolean) => (
		<Box flexDirection='column' width={width} height={height} overflow='hidden'>
			{viewport(wrapped(lines, width), height, state, active).visible.map((line, index) => (
				<Text
					key={`${index}:${line.text}`}
					color={color(line.tone)}
					bold={line.bold || line.selected}
					wrap='truncate-end'
				>
					{line.text || ' '}
				</Text>
			))}
		</Box>
	)
	const leftLines =
		state.step === 'result' ? resultSummary(state) : overviewLines(state, now, leftWidth - 4, innerHeight)
	// Ink 每帧附加一个换行，因此布局为真实 TTY 光标保留最后一行。
	return (
		<Box flexDirection='column' width={columns} height={rows - 1}>
			<Box flexDirection='column' height={3}>
				<Text color={color('accent')} bold>
					{clip(
						`mito-node | ${state.selected ? `${processName(state.selected)} | PID ${state.selected.pid} | ` : ''}Node.js 诊断工作台`,
						columns
					)}
				</Text>
				<Text color={color(expired ? 'warning' : 'muted')}>
					{clip(
						`SDK ${sample?.sdk ? '已注册' : '未确认'} | Agent ${sample?.agent ? '已连接' : '未连接'} | 来源 ${sample?.source ?? '暂无数据'} | 样本龄 ${age === null ? '暂无数据' : `${(age / 1000).toFixed(1)}s`}${expired ? '（过期）' : ''}`,
						columns
					)}
				</Text>
				<Text color={color('accent')}>
					{tabs
						.map((tab) => ((state.workspaceTab ?? 'overview') === tab.id ? `[ ${tab.label} ]` : tab.label))
						.join('   ')}
				</Text>
			</Box>
			{wide && !special ? (
				<Box height={mainHeight} columnGap={1}>
					<Box
						width={leftWidth}
						height={mainHeight}
						borderStyle='single'
						borderColor={color(area === 'overview' ? 'accent' : 'muted')}
						paddingX={1}
					>
						{renderLines(leftLines, leftWidth - 4, innerHeight, area === 'overview')}
					</Box>
					<Box
						width={rightWidth}
						height={mainHeight}
						borderStyle='single'
						borderColor={color(area === 'tasks' || area === 'parameters' ? 'accent' : 'muted')}
						paddingX={1}
					>
						{renderLines(taskLines(state), rightWidth - 4, innerHeight, area === 'tasks' || area === 'parameters')}
					</Box>
				</Box>
			) : (
				<Box height={mainHeight} borderStyle='single' borderColor={color('accent')} paddingX={1}>
					{renderLines(focused.lines, columns - 4, innerHeight, true)}
				</Box>
			)}
			{wide && !special && (
				<Box
					height={5}
					borderStyle='single'
					borderColor={color(area === 'artifacts' ? 'accent' : 'muted')}
					paddingX={1}
				>
					{renderLines(
						artifactLines(state, false).map((line) => ({ ...line, text: clip(line.text, columns - 4) })),
						columns - 4,
						3,
						area === 'artifacts'
					)}
				</Box>
			)}
			<Box flexDirection='column' height={2}>
				<Text color={color('muted')}>
					{clip(
						state.step === 'select'
							? '↑↓ 选择  Enter 确认  / 搜索  R 刷新  X 命令  H 历史'
							: state.step === 'result' && area === 'overview'
								? '↑↓ 滚动  R 重试  Enter 返回  X 堆栈  P 换进程'
								: `↑↓ ${area === 'parameters' ? '字段' : area === 'artifacts' ? '滚动' : '任务'}  ←→ 页签  Tab 区域/字段  Enter 设置/执行  Esc 返回/取消`,
						columns
					)}
				</Text>
				<Text color={color('muted')}>
					{clip(
						`? 帮助  Ctrl+C 退出${!special ? ` | 区域 ${area === 'overview' ? '指标' : area === 'tasks' ? '任务' : area === 'parameters' ? '参数' : '产物'}` : ''}${visible.max ? ` | PgUp/PgDn 滚动 ${visible.offset + 1}/${focused.lines.length}` : ''}`,
						columns
					)}
				</Text>
			</Box>
		</Box>
	)
}

export interface AppProps {
	controller: TuiController
	initialPid?: number
	columns?: number
	rows?: number
	noColor?: boolean
}
export function InteractiveApp({ controller, initialPid, columns, rows, noColor }: AppProps) {
	const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
	const { stdout } = useStdout()
	const { exit } = useApp()
	const [dimensions, setDimensions] = useState({ columns: stdout.columns || 80, rows: stdout.rows || 24 })
	const [now, setNow] = useState(Date.now())
	useEffect(() => {
		void controller.refreshProcesses(initialPid)
		const resize = () => setDimensions({ columns: stdout.columns || 80, rows: stdout.rows || 24 })
		stdout.on('resize', resize)
		const timer = setInterval(() => setNow(Date.now()), 100)
		return () => {
			stdout.off('resize', resize)
			clearInterval(timer)
			controller.dispose()
		}
	}, [controller, initialPid, stdout])
	const scroll = (delta: number) => {
		const current = controller.getSnapshot()
		const pane = focusedPane(current, columns ?? dimensions.columns, rows ?? dimensions.rows, now)
		const window = viewport(pane.lines, pane.height, current)
		controller.scroll(delta, { current: window.offset, max: window.max })
	}
	useInput((input, key) => {
		const state = controller.getSnapshot()
		if (key.ctrl && input === 'c') {
			void controller.shutdown().then(() => {
				process.exitCode = 130
				exit()
			})
			return
		}
		if (state.closing) return
		if (key.escape) {
			controller.back()
			return
		}
		if (state.help) {
			if (input === '?') controller.toggleHelp()
			else if (key.upArrow || input === 'k') scroll(-1)
			else if (key.downArrow || input === 'j') scroll(1)
			else if (key.pageDown) scroll(8)
			else if (key.pageUp) scroll(-8)
			return
		}
		if (input === '?') {
			controller.toggleHelp()
			return
		}
		// 运行时保留原始任务与参数，切换页签不能改变取消操作对应的命令。
		if (state.step === 'running') {
			if (key.pageDown) scroll(8)
			else if (key.pageUp) scroll(-8)
			return
		}
		if (state.step === 'select' && state.searching) {
			if (key.return) controller.stopSearch()
			else if (key.backspace || key.delete) controller.setQuery(Array.from(state.query).slice(0, -1).join(''))
			else if (key.ctrl && input === 'u') controller.setQuery('')
			else if (!key.ctrl && !key.meta && input) controller.setQuery(state.query + input.replace(/[\r\n]/g, ''))
			return
		}
		if (key.tab) {
			controller.toggleFocus(key.shift ? -1 : 1)
			return
		}
		if ((state.step === 'collect' || state.step === 'status') && state.workspaceArea === 'parameters') {
			const field = Object.keys(state.fields)[state.fieldIndex]
			if (key.return) void controller.run()
			else if (key.upArrow) controller.moveSelection(-1)
			else if (key.downArrow) controller.moveSelection(1)
			else if (key.ctrl && input === 'u') controller.setField(field, '')
			else if (key.backspace || key.delete)
				controller.setField(
					field,
					Array.from(state.fields[field] ?? '')
						.slice(0, -1)
						.join('')
				)
			else if (!key.ctrl && !key.meta && input)
				controller.setField(field, (state.fields[field] ?? '') + input.replace(/[\r\n]/g, ''))
			return
		}
		if (key.pageDown) {
			scroll(8)
			return
		}
		if (key.pageUp) {
			scroll(-8)
			return
		}
		if (state.step !== 'select' && (key.leftArrow || key.rightArrow)) {
			controller.cycleWorkspaceTab(key.rightArrow ? 1 : -1)
			return
		}
		if (key.upArrow || key.downArrow) {
			// 总览中的主操作是选择右侧任务；指标长内容已有 J/K 和翻页键，不能吞掉任务方向键。
			if (
				state.step === 'select' ||
				state.workspaceArea === 'tasks' ||
				(state.step !== 'result' && (state.workspaceArea ?? 'overview') === 'overview')
			)
				controller.moveSelection(key.downArrow ? 1 : -1)
			else scroll(key.downArrow ? 1 : -1)
			return
		}
		if (input === 'j' || input === 'k') {
			scroll(input === 'j' ? 1 : -1)
			return
		}
		if (input.toLowerCase() === 'p') {
			controller.switchProcess()
			return
		}
		if (input.toLowerCase() === 'h') {
			controller.openAction('history')
			return
		}
		if (input.toLowerCase() === 'x') {
			controller.toggleExpanded()
			return
		}
		if (state.step === 'select') {
			if (input === '/') controller.search()
			else if (input.toLowerCase() === 'r') void controller.refreshProcesses()
			else if (key.return) {
				const proc = filterProcesses(state.processes, state.query)[state.processIndex]
				if (proc) controller.selectProcess(proc)
			}
		} else if (state.step === 'result') {
			if (input.toLowerCase() === 'r') controller.retry()
			else if (key.return) controller.back()
		} else if (key.return) controller.openAction(actions[state.actionIndex].id)
	})
	return (
		<TuiView
			state={state}
			columns={columns ?? dimensions.columns}
			rows={rows ?? dimensions.rows}
			now={now}
			noColor={noColor}
		/>
	)
}

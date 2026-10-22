import { cleanup, render } from 'ink-testing-library'
import stringWidth from 'string-width'
import { afterEach, describe, expect, it } from 'vitest'
import { InteractiveApp, TuiView } from '../../tui/app.js'
import type { TuiState } from '../../tui/controller.js'
import { TuiController } from '../../tui/controller.js'

const processFixture = { pid: 101, ppid: 1, stime: '10:00', time: '0:00', command: 'node /app/支付-api.js --port=3000' }
const controllers: TuiController[] = []
afterEach(() => {
	cleanup()
	for (const controller of controllers.splice(0)) controller.dispose()
})
const flush = () => new Promise((resolve) => setTimeout(resolve, 30))
const state = (patch: Partial<TuiState> = {}): TuiState => ({
	step: 'status',
	processes: [processFixture],
	processIndex: 0,
	query: '',
	searching: false,
	loading: false,
	selected: processFixture,
	samples: [
		{
			at: 10000,
			cpu: 245.5,
			rss: 100 * 1024 * 1024,
			heapUsed: 20 * 1024 * 1024,
			heapTotal: 40 * 1024 * 1024,
			errors: null,
			timers: null,
			source: 'inspector',
			sdk: false,
			agent: false,
			ageMs: 0,
			stale: false,
		},
	],
	actionIndex: 0,
	fields: {},
	fieldIndex: 0,
	focus: 'actions',
	progress: '',
	elapsedMs: 0,
	help: false,
	expanded: false,
	scroll: 0,
	...patch,
})

describe('guided terminal rendering', () => {
	it.each([
		{ columns: 70, rows: 20 },
		{ columns: 80, rows: 24 },
		{ columns: 120, rows: 20 },
		{ columns: 160, rows: 24 },
		{ columns: 120, rows: 36 },
		{ columns: 160, rows: 40 },
	])('shows CPU and memory line charts together without scrolling at $columns×$rows', ({ columns, rows }) => {
		const samples = [30000, 40000, 50000, 60000].map((at) => ({
			...state().samples[0],
			at,
			cpuAt: at,
			memoryAt: at,
			cpuIntervalMs: 10000,
			memoryIntervalMs: 10000,
			cpu: 0.1,
			rss: 64 * 1024 * 1024,
		}))
		const ui = render(<TuiView state={state({ samples })} columns={columns} rows={rows} now={60000} noColor />)
		const screen = ui.lastFrame() ?? ''
		expect(screen).toContain('CPU 使用率 (%)')
		expect(screen).toContain('内存 RSS (MiB)')
		expect(screen).toContain('0.1%')
		expect(screen).toContain('64.0')
		expect(screen).not.toContain('•')
		expect(screen.match(/-60s/g)).toHaveLength(2)
		expect(screen.match(/现在/g)).toHaveLength(2)
		expect(screen.split('\n').length).toBeLessThan(rows)
		for (const line of screen.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(columns)
	})
	it.each(['cpu', 'memory'] as const)('keeps multiple metric charts visible on the %s tab', (workspaceTab) => {
		const ui = render(<TuiView state={state({ workspaceTab })} columns={80} rows={24} now={10000} noColor />)
		const screen = ui.lastFrame() ?? ''
		expect(screen).toContain('内存 RSS (MiB)')
		expect(screen).toContain(workspaceTab === 'cpu' ? 'CPU 使用率 (%)' : 'Heap 已用 (MiB)')
		expect(screen).not.toContain('•')
	})
	it('keeps both time axes visible with collection warnings in the minimum terminal size', () => {
		const current = state()
		current.samples[0] = {
			...current.samples[0],
			failure: 'Agent data temporarily unavailable',
			errorsDropped: 3,
			timersDropped: 2,
		}
		const ui = render(<TuiView state={current} columns={70} rows={20} now={10000} noColor />)
		const screen = ui.lastFrame() ?? ''
		expect(screen).toContain('采集提示')
		expect(screen).toContain('记录截断')
		expect(screen.match(/现在/g)).toHaveLength(2)
		expect(screen).not.toContain('PgUp/PgDn 滚动')
	})
	it('uses distinct axis labels for low CPU usage', () => {
		const current = state()
		current.samples[0] = { ...current.samples[0], cpu: 0.1 }
		const ui = render(<TuiView state={current} columns={80} rows={24} now={10000} noColor />)
		const screen = ui.lastFrame() ?? ''
		expect(screen).toContain('0.10│')
		expect(screen).toContain('0.05│')
		expect(screen).toContain('0.00│')
	})
	it('keeps both plots aligned when memory changes by only one page', () => {
		const samples = [1000, 2000].map((at, index) => ({
			...state().samples[0],
			at,
			rss: 100 * 1024 * 1024 + index * 4096,
		}))
		const ui = render(<TuiView state={state({ samples })} columns={160} rows={40} now={2000} noColor />)
		const lines = (ui.lastFrame() ?? '').split('\n')
		const title = lines.findIndex((line) => line.includes('CPU 使用率 (%)'))
		for (const line of lines.slice(title + 2, title + 10)) expect(line.match(/\d+\.\d+│/g)).toHaveLength(2)
	})
	it.each([120, 80])(
		'uses arrow keys to choose a task immediately after entering the %s-column dashboard',
		async (columns) => {
			const controller = new TuiController({
				getProcesses: () => [processFixture],
				getProcessInfo: async () => null,
				execute: async (command) => ({ success: true, command, data: {} }),
				pollInterval: 60000,
			})
			controllers.push(controller)
			const ui = render(<InteractiveApp controller={controller} initialPid={101} columns={columns} rows={36} noColor />)
			await flush()
			expect(controller.getSnapshot()).toMatchObject({ step: 'status', actionIndex: 1 })
			ui.stdin.write('\u001b[B')
			await flush()
			expect(controller.getSnapshot()).toMatchObject({ workspaceArea: 'tasks', actionIndex: 2 })
			expect(ui.lastFrame()).toContain('› 查看内存详情')
			ui.stdin.write('\u001b[A')
			await flush()
			expect(controller.getSnapshot().actionIndex).toBe(1)
			expect(ui.lastFrame()).toContain('› 采集 CPU Profile')
			ui.stdin.write('\r')
			await flush()
			expect(controller.getSnapshot()).toMatchObject({ workspaceArea: 'parameters', fields: { duration: '10000' } })
			ui.stdin.write('\u001b[B')
			await flush()
			expect(controller.getSnapshot()).toMatchObject({ actionIndex: 1, fieldIndex: 1 })
		}
	)
	it('keeps result scrolling on arrows but lets the focused task pane choose the next operation', async () => {
		const controller = new TuiController({
			getProcesses: () => [processFixture],
			getProcessInfo: async () => null,
			execute: async (command) => ({
				success: true,
				command,
				data: { lines: Array.from({ length: 50 }, (_, i) => i) },
			}),
			pollInterval: 60000,
		})
		controllers.push(controller)
		const ui = render(<InteractiveApp controller={controller} initialPid={101} columns={120} rows={36} noColor />)
		await flush()
		controller.openAction('memory')
		await controller.run()
		await flush()
		ui.stdin.write('\u001b[B')
		await flush()
		expect(controller.getSnapshot()).toMatchObject({ step: 'result', actionIndex: 2, scroll: 1 })
		ui.stdin.write('\t')
		await flush()
		ui.stdin.write('\u001b[B')
		await flush()
		expect(controller.getSnapshot()).toMatchObject({ step: 'collect', workspaceArea: 'tasks', actionIndex: 3 })
		expect(ui.lastFrame()).toContain('› 查看最近错误')
		ui.stdin.write('\r')
		await flush()
		expect(controller.getSnapshot()).toMatchObject({ workspaceArea: 'parameters', actionIndex: 3 })
	})
	it('explains which SDK-only metrics are unavailable while Inspector CPU and memory remain usable', () => {
		const ui = render(<TuiView state={state()} columns={120} rows={36} now={10000} noColor />)
		expect(ui.lastFrame()).toContain('仅 Inspector')
		expect(ui.lastFrame()).toContain('CPU / 内存可用')
		expect(ui.lastFrame()).toContain('错误 / 定时器需接入 SDK')
	})
	it('makes target, source, honest missing metrics and the selected next action visible at 80x24', () => {
		const ui = render(<TuiView state={state()} columns={80} rows={24} now={10000} noColor />)
		const screen = ui.lastFrame() ?? ''
		expect(screen).toContain('PID 101')
		expect(screen).toContain('inspector')
		expect(screen).toContain('245.5%')
		expect(screen).toContain('暂无数据')
		expect(screen).toContain('组合诊断')
		expect(screen.split('\n').length).toBeLessThanOrEqual(24)
		expect(screen).not.toContain('\u001b[')
	})
	it('adapts the C two-column workbench to a compact active pane and warns when the viewport is too small', async () => {
		const ui = render(<TuiView state={state()} columns={120} rows={36} now={10000} noColor />)
		expect(ui.lastFrame()).toContain('诊断任务')
		ui.rerender(<TuiView state={state()} columns={80} rows={24} now={10000} noColor />)
		await flush()
		expect(ui.lastFrame()).not.toContain('诊断任务')
		ui.rerender(<TuiView state={state()} columns={60} rows={16} now={10000} noColor />)
		await flush()
		expect(ui.lastFrame()).toContain('终端窗口过小')
	})
	it('shows actual result values, file guidance and cancellation limitations', () => {
		const ui = render(
			<TuiView
				state={state({
					step: 'result',
					actionIndex: 5,
					result: { success: true, command: 'report', data: { filename: '/tmp/report.json' } },
				})}
				columns={120}
				rows={36}
				now={10000}
				noColor
			/>
		)
		expect(ui.lastFrame()).toContain('/tmp/report.json')
		expect(ui.lastFrame()).toContain('JSON')
		ui.rerender(
			<TuiView
				state={state({ step: 'running', progress: '正在采集 CPU', elapsedMs: 1234 })}
				columns={80}
				rows={24}
				now={10000}
				noColor
			/>
		)
		expect(ui.lastFrame()).toContain('目标操作')
	})
	it('lets the user search/select a process, edit parameters and view a false result through real keyboard input', async () => {
		const controller = new TuiController({
			getProcesses: () => [processFixture],
			getProcessInfo: async () => null,
			execute: async (command) => ({ success: true, command, data: command === 'run-code' ? false : {} }),
			pollInterval: 60000,
		})
		controllers.push(controller)
		const ui = render(<InteractiveApp controller={controller} columns={80} rows={24} noColor />)
		await flush()
		ui.stdin.write('/')
		ui.stdin.write('101')
		await flush()
		expect(ui.lastFrame()).toContain('101')
		ui.stdin.write('\r')
		await flush()
		ui.stdin.write('\r')
		await flush()
		expect(controller.getSnapshot().step).toBe('status')
		controller.openAction('run-code')
		await flush()
		ui.stdin.write('return false')
		ui.stdin.write('\r')
		await flush()
		expect(ui.lastFrame()).toContain('false')
		expect(controller.getSnapshot().result?.data).toBe(false)
	})
})

it('shows a complete selected command immediately even when the process list is long', () => {
	const processes = Array.from({ length: 30 }, (_, index) => ({
		...processFixture,
		pid: index + 1000,
		command: `node /app/service-${index}.js --extra=完整启动参数`,
	}))
	const ui = render(
		<TuiView
			state={state({ step: 'select', selected: undefined, processes, processIndex: 0, expanded: true })}
			columns={80}
			rows={24}
			now={10000}
			noColor
		/>
	)
	expect(ui.lastFrame()).toContain('完整启动命令')
	expect(ui.lastFrame()).toContain('--extra=完整启动参数')
})

it('keeps a parameter validation error visible and lets users open help without altering the parameter', async () => {
	const controller = new TuiController({
		getProcesses: () => [],
		getProcessInfo: async () => null,
		execute: async (command) => ({ success: true, command }),
	})
	controllers.push(controller)
	controller.openAction('run-code')
	const ui = render(<InteractiveApp controller={controller} columns={80} rows={24} noColor />)
	await flush()
	ui.stdin.write('\r')
	await flush()
	expect(ui.lastFrame()).toContain('请提供 JS 代码')
	ui.stdin.write('?')
	await flush()
	expect(ui.lastFrame()).toContain('键盘帮助')
	expect(controller.getSnapshot().fields.code).toBe('')
})

it('allows compact result content to scroll down and return to its first line with PageUp', async () => {
	const controller = new TuiController({
		getProcesses: () => [processFixture],
		getProcessInfo: async () => null,
		execute: async (command) => ({
			success: true,
			command,
			data:
				command === 'history'
					? {
							records: Array.from({ length: 20 }, (_, index) => ({
								id: `record-${index}`,
								timestamp: '2026-10-22T10:00:00Z',
								command: 'memory',
								success: true,
								pid: 101,
								artifacts: [],
							})),
						}
					: {},
		}),
		pollInterval: 60000,
	})
	controllers.push(controller)
	const ui = render(<InteractiveApp controller={controller} columns={80} rows={24} noColor />)
	await flush()
	controller.openAction('history')
	await controller.run()
	await flush()
	expect(ui.lastFrame()).toContain('完成 · 查看诊断记录')
	ui.stdin.write('\u001b[6~')
	await flush()
	expect(ui.lastFrame()).not.toContain('完成 · 查看诊断记录')
	ui.stdin.write('\u001b[5~')
	await flush()
	expect(ui.lastFrame()).toContain('完成 · 查看诊断记录')
})

it('summarizes memory, empty errors and active timers in human units rather than requiring users to interpret raw bytes', async () => {
	const ui = render(
		<TuiView
			state={state({
				step: 'result',
				result: {
					success: true,
					command: 'memory',
					data: { source: 'agent', memory: { rss: 104857600, heapUsed: 20971520, heapTotal: 41943040 } },
				},
			})}
			columns={120}
			rows={36}
			now={10000}
			noColor
		/>
	)
	expect(ui.lastFrame()).toContain('RSS 100.0 MiB')
	expect(ui.lastFrame()).toContain('Heap 20.0 MiB / 40.0 MiB')
	ui.rerender(
		<TuiView
			state={state({ step: 'result', result: { success: true, command: 'errors', data: { errors: [] } } })}
			columns={120}
			rows={36}
			now={10000}
			noColor
		/>
	)
	await flush()
	expect(ui.lastFrame()).toContain('最近错误: 0 条')
	ui.rerender(
		<TuiView
			state={state({
				step: 'result',
				result: {
					success: true,
					command: 'timers',
					data: { timers: [{ id: 1, name: 'setInterval', stack: 'Error\n at /app/task.js:4' }] },
				},
			})}
			columns={120}
			rows={36}
			now={10000}
			noColor
		/>
	)
	await flush()
	expect(ui.lastFrame()).toContain('活跃定时器: 1 个')
})

it.each([
	{ columns: 120, rows: 30 },
	{ columns: 80, rows: 24 },
])(
	'keeps the brand and footer inside a $columns×$rows terminal after Ink appends its cursor newline',
	({ columns, rows }) => {
		const ui = render(<TuiView state={state()} columns={columns} rows={rows} now={10000} noColor />)
		// Ink's real log-update writes the frame plus a newline; the last cursor row must fit too.
		const terminalOutput = `${ui.lastFrame() ?? ''}\n`
		expect(terminalOutput.split('\n').length).toBeLessThanOrEqual(rows)
		expect(terminalOutput.split('\n')[0]).toContain('mito-node')
		expect(terminalOutput).toContain('Ctrl+C 退出')
	}
)

it('renders the selected C workbench with metrics, recent evidence and real artifacts beside editable diagnostic tasks', () => {
	const ui = render(
		<TuiView
			state={state({
				artifacts: [
					{
						path: '/tmp/actual.cpuprofile',
						command: 'cpuprofile',
						timestamp: '2026-10-22T10:00:00.000Z',
						source: 'inspector',
					},
				],
			})}
			columns={120}
			rows={36}
			now={10000}
			noColor
		/>
	)
	const screen = ui.lastFrame() ?? ''
	expect(screen).toContain('诊断工作台')
	expect(screen).toContain('诊断任务')
	expect(screen).toContain('进程状态')
	expect(screen).toContain('最近错误')
	expect(screen).toContain('最近产物')
	expect(screen).toContain('/tmp/actual.cpuprofile')
	expect(screen).toContain('CPU')
	expect(screen).toContain('内存')
	expect(screen).not.toContain('B 引导模式')
	expect(screen).not.toContain('定位目标')
})

it('switches C tabs and keyboard regions while keeping parameter input inside the selected task', async () => {
	const controller = new TuiController({
		getProcesses: () => [processFixture],
		getProcessInfo: async () => null,
		execute: async (command) => ({ success: true, command, data: {} }),
		pollInterval: 60000,
	})
	controllers.push(controller)
	const ui = render(<InteractiveApp controller={controller} columns={80} rows={24} noColor />)
	await flush()
	ui.stdin.write('\r')
	await flush()
	ui.stdin.write('\u001b[C')
	await flush()
	expect(ui.lastFrame()).toContain('[ CPU ]')
	ui.stdin.write('\t')
	await flush()
	expect(ui.lastFrame()).toContain('诊断任务')
	ui.stdin.write('\r')
	await flush()
	ui.stdin.write('\u0015')
	ui.stdin.write('5000')
	await flush()
	expect(controller.getSnapshot().fields.duration).toBe('5000')
	ui.stdin.write('\u001b[C')
	await flush()
	expect(ui.lastFrame()).toContain('[ CPU ]')
	expect(controller.getSnapshot().fields.duration).toBe('5000')
})

it('keeps the running task fixed while navigation keys are pressed and cancels that same operation', async () => {
	let finish: (value: { success: boolean; command: string }) => void = () => {}
	const controller = new TuiController({
		getProcesses: () => [processFixture],
		getProcessInfo: async () => null,
		execute: async (command) =>
			command === 'cpuprofile'
				? new Promise((resolve) => {
						finish = resolve
					})
				: { success: true, command, data: {} },
		pollInterval: 60000,
	})
	controllers.push(controller)
	controller.selectProcess(processFixture)
	const ui = render(<InteractiveApp controller={controller} columns={80} rows={24} noColor />)
	const running = controller.run()
	await flush()
	ui.stdin.write('\u001b[C')
	ui.stdin.write('\u001b[C')
	ui.stdin.write('\t')
	ui.stdin.write('\u001b[B')
	await flush()
	expect(controller.getSnapshot().actionIndex).toBe(1)
	expect(controller.getSnapshot().fields.duration).toBe('10000')
	ui.stdin.write('\u001b')
	await flush()
	expect(controller.getSnapshot()).toMatchObject({ step: 'running', cancelling: true })
	expect(ui.lastFrame()).toContain('正在取消')
	finish({ success: true, command: 'cpuprofile' })
	await running
	expect(controller.getSnapshot().result).toMatchObject({ command: 'cpuprofile', errorCode: 'CANCELLED' })
})

it('keeps precise CPU measurements visible alongside the line chart', () => {
	const current = state()
	current.samples[0] = { ...current.samples[0], cpu: 80.125 }
	const ui = render(<TuiView state={current} columns={120} rows={36} now={10000} noColor />)
	const screen = ui.lastFrame() ?? ''
	expect(screen).toContain('现80.1%')
	expect(screen).toContain('均80.1%')
	expect(screen).toContain('峰80.1%')
	expect(screen).toContain('CPU 使用率 (%)')
	expect(screen).not.toContain('•')
})

it('shows a saved Profile path and viewing guidance alongside a cleanup failure', () => {
	const ui = render(
		<TuiView
			state={state({
				step: 'result',
				actionIndex: 1,
				result: {
					success: false,
					command: 'cpuprofile',
					error: 'Profile saved but Inspector cleanup failed',
					errorCode: 'CLEANUP_FAILED',
					suggestion: 'Inspect target connection state',
					data: { filename: '/tmp/saved-evidence.cpuprofile', source: 'inspector' },
				},
			})}
			columns={120}
			rows={36}
			now={10000}
			noColor
		/>
	)
	const screen = ui.lastFrame() ?? ''
	expect(screen).toContain('CLEANUP_FAILED')
	expect(screen).toContain('/tmp/saved-evidence.cpuprofile')
	expect(screen).toContain('Load profile')
	expect(screen).toContain('Profile saved but Inspector cleanup failed')
})

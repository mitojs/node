import type { OutputData } from '../core/types.js'
import type { NodeProcess } from '../shared/command.js'
import type { AgentObservation, DashboardSample } from './model.js'
import { actions, appendSample, buildSample, filterProcesses, validateParameters } from './model.js'

export interface ControllerDependencies {
	getProcesses: () => NodeProcess[] | Promise<NodeProcess[]>
	getProcessInfo: (pid: number, signal?: AbortSignal) => Promise<AgentObservation | null>
	execute: (
		command: string,
		options: Record<string, unknown>,
		settings: {
			pid: number
			timeout?: number
			signal?: AbortSignal
			recordHistory?: boolean
			onEvent?: (event: { message?: string }) => void
		}
	) => Promise<OutputData>
	now?: () => number
	pollInterval?: number
}

export type WorkspaceTab = 'overview' | 'cpu' | 'memory' | 'errors' | 'timers' | 'artifacts'
export type WorkspaceArea = 'overview' | 'tasks' | 'parameters' | 'artifacts'
export interface RecentArtifact {
	path: string
	command: string
	timestamp: string
	source: string
	pid?: number
}

export interface TuiState {
	step: 'select' | 'status' | 'collect' | 'running' | 'result'
	workspaceTab?: WorkspaceTab
	workspaceArea?: WorkspaceArea
	artifacts?: RecentArtifact[]
	artifactWarning?: string
	cancelling?: boolean
	closing?: boolean
	processes: NodeProcess[]
	processIndex: number
	query: string
	searching: boolean
	loading: boolean
	selected?: NodeProcess
	samples: DashboardSample[]
	actionIndex: number
	fields: Record<string, string>
	fieldIndex: number
	focus: 'actions' | 'parameters'
	error?: string
	result?: OutputData
	progress: string
	elapsedMs: number
	help: boolean
	expanded: boolean
	scroll: number
	manualScroll?: boolean
}

export class TuiController {
	private state: TuiState = {
		step: 'select',
		processes: [],
		processIndex: 0,
		query: '',
		searching: false,
		loading: false,
		samples: [],
		actionIndex: 1,
		fields: { ...actions[1].defaults },
		workspaceTab: 'overview',
		workspaceArea: 'overview',
		artifacts: [],
		fieldIndex: 0,
		focus: 'actions',
		progress: '',
		elapsedMs: 0,
		help: false,
		expanded: false,
		scroll: 0,
	}
	private listeners = new Set<() => void>()
	private sampleTimer?: ReturnType<typeof setTimeout>
	private elapsedTimer?: ReturnType<typeof setInterval>
	private sampleAbort?: AbortController
	private runAbort?: AbortController
	private sampleEpoch = 0
	private operationEpoch = 0
	private refreshEpoch = 0
	private disposed = false
	private activeExecution?: Promise<OutputData>
	private activeSampling?: Promise<void>
	private closingPromise?: Promise<void>
	private readonly now: () => number

	constructor(private readonly dependencies: ControllerDependencies) {
		this.now = dependencies.now ?? Date.now
	}

	// 快照对象在状态变化前保持同一引用，供 React 的外部 store 订阅使用。
	getSnapshot = (): TuiState => this.state
	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	private update(patch: Partial<TuiState>) {
		if (this.disposed) return
		this.state = { ...this.state, ...(patch.scroll === 0 ? { manualScroll: false } : {}), ...patch }
		for (const listener of this.listeners) listener()
	}

	async refreshProcesses(preferredPid?: number) {
		const epoch = ++this.refreshEpoch
		this.update({ loading: true, error: undefined })
		try {
			const processes = (await this.dependencies.getProcesses()).filter((proc) => proc.pid !== process.pid)
			if (epoch !== this.refreshEpoch) return
			const count = filterProcesses(processes, this.state.query).length
			this.update({
				processes,
				processIndex: Math.max(0, Math.min(this.state.processIndex, count - 1)),
				loading: false,
			})
			// demo 和 --pid 必须绑定明确目标，不能把列表中的其他后台 Node 服务当作示例。
			if (preferredPid !== undefined) {
				const target = processes.find((proc) => proc.pid === preferredPid)
				if (target) this.selectProcess(target)
				else this.update({ error: `未找到 Node.js 进程 ${preferredPid}；目标可能已退出，请启动后按 R 刷新。` })
			}
		} catch (error) {
			if (epoch === this.refreshEpoch)
				this.update({
					loading: false,
					error: `获取进程失败: ${error instanceof Error ? error.message : String(error)}`,
				})
		}
	}

	selectProcess(proc: NodeProcess) {
		if (this.state.step === 'running' || this.state.closing) return
		this.stopSampling()
		this.cancelOperation()
		this.update({
			selected: proc,
			cancelling: false,
			workspaceTab: 'overview',
			workspaceArea: 'overview',
			actionIndex: 1,
			fields: { ...actions[1].defaults },
			fieldIndex: 0,
			step: 'status',
			samples: [],
			result: undefined,
			error: undefined,
			elapsedMs: 0,
			scroll: 0,
			expanded: false,
			searching: false,
			focus: 'actions',
		})
		void this.refreshArtifacts()
		this.startSampling()
	}

	private stopSampling() {
		++this.sampleEpoch
		clearTimeout(this.sampleTimer)
		this.sampleAbort?.abort()
	}

	private startSampling() {
		if (this.disposed || !['status', 'collect'].includes(this.state.step) || !this.state.selected) return
		const previousSampling = this.activeSampling
		this.stopSampling()
		const epoch = ++this.sampleEpoch
		const pid = this.state.selected.pid
		const sample = async () => {
			const startedAt = this.now()
			let nextInterval = this.dependencies.pollInterval ?? 1000
			this.sampleAbort = new AbortController()
			const settings = { pid, timeout: 10000, signal: this.sampleAbort.signal, recordHistory: false }
			try {
				const info = await this.dependencies.getProcessInfo(pid, this.sampleAbort.signal)
				if (epoch !== this.sampleEpoch) return
				// Inspector 的连接有所有权；顺序采样避免两个命令互相关闭同一目标会话。
				const cpu = await this.dependencies.execute('monitor-cpu', {}, settings)
				if (epoch !== this.sampleEpoch) return
				const memory = await this.dependencies.execute('monitor-memory', {}, settings)
				if (epoch !== this.sampleEpoch) return
				const senderIntervals = [
					cpu.data?.source === 'agent' ? (cpu.data.interval ?? info?.intervals?.CPU) : undefined,
					memory.data?.source === 'agent' ? (memory.data.interval ?? info?.intervals?.Memory) : undefined,
				].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
				// 刷新必须跟上发送方；不能靠延长过期窗口把健康的 250ms 流显示为旧数据。
				if (senderIntervals.length)
					nextInterval = Math.min(nextInterval, Math.max(100, Math.min(1000, ...senderIntervals)))
				this.update({ samples: appendSample(this.state.samples, buildSample(cpu, memory, info, this.now())) })
			} catch (error) {
				if (epoch === this.sampleEpoch) {
					const failed = {
						success: false,
						command: 'monitor-cpu',
						error: error instanceof Error ? error.message : String(error),
					}
					this.update({
						samples: appendSample(
							this.state.samples,
							buildSample(failed, { ...failed, command: 'monitor-memory' }, null, this.now())
						),
					})
				}
			} finally {
				if (epoch === this.sampleEpoch && !this.disposed)
					this.sampleTimer = setTimeout(poll, Math.max(100, nextInterval - (this.now() - startedAt)))
			}
		}
		const poll = () => {
			this.activeSampling = sample()
		}
		// SIGUSR1 激活和 owned Inspector 关闭共享本机端口；新目标必须等旧执行器清理结束。
		if (previousSampling) {
			void previousSampling
				.catch(() => {})
				.then(() => {
					if (epoch === this.sampleEpoch && !this.disposed && !this.state.closing) poll()
				})
		} else poll()
	}

	openAction(id: string) {
		if (this.state.step === 'running' || this.state.closing) return
		const index = actions.findIndex((action) => action.id === id)
		if (index < 0) return
		this.update({
			workspaceArea: 'parameters',
			step: 'collect',
			actionIndex: index,
			fields: { ...actions[index].defaults },
			fieldIndex: 0,
			focus: 'parameters',
			error: undefined,
			scroll: 0,
			expanded: false,
		})
	}

	setField(key: string, value: string) {
		this.update({ fields: { ...this.state.fields, [key]: value }, error: undefined })
	}

	async run() {
		if (this.state.step === 'running' || this.state.closing) return
		const action = actions[this.state.actionIndex]
		const validated = validateParameters(action.command, this.state.fields)
		if (validated.error) {
			this.update({ error: validated.error })
			return
		}
		if (!action.noTarget && !this.state.selected) {
			this.update({ error: '请先选择要诊断的进程' })
			return
		}
		this.stopSampling()
		this.cancelOperation()
		const epoch = ++this.operationEpoch
		this.runAbort = new AbortController()
		const started = this.now()
		this.update({
			step: 'running',
			cancelling: false,
			workspaceArea: 'tasks',
			result: undefined,
			error: undefined,
			progress: '准备连接并执行',
			elapsedMs: 0,
			scroll: 0,
		})
		this.elapsedTimer = setInterval(() => this.update({ elapsedMs: this.now() - started }), 200)
		let execution: Promise<OutputData> | undefined
		try {
			// Abort 请求不等于端口已释放；等待被动采样的 finally 后再开始用户诊断。
			await this.activeSampling?.catch(() => {})
			if (epoch !== this.operationEpoch || this.disposed) return
			if (this.runAbort.signal.aborted) {
				this.update({
					step: 'result',
					workspaceArea: 'overview',
					cancelling: false,
					result: this.cancelledResult(action.command),
					elapsedMs: this.now() - started,
					scroll: 0,
				})
				return
			}
			execution = this.dependencies.execute(
				action.command,
				{ ...validated.options, ...action.preset },
				{
					pid: action.noTarget ? 0 : (this.state.selected?.pid ?? 0),
					timeout: validated.timeout,
					signal: this.runAbort.signal,
					onEvent: (event) => {
						if (epoch === this.operationEpoch && event.message) this.update({ progress: event.message })
					},
				}
			)
			this.activeExecution = execution
			const result = await execution
			// executor 的 Promise 包含 Inspector 清理，等待完成后才允许下一次诊断。
			if (epoch === this.operationEpoch) {
				this.update({
					step: 'result',
					workspaceArea: 'overview',
					result: this.state.cancelling ? this.cancelledResult(action.command) : result,
					cancelling: false,
					elapsedMs: this.now() - started,
					scroll: 0,
					expanded: false,
				})
				void this.refreshArtifacts()
			}
		} catch (error) {
			if (epoch === this.operationEpoch)
				this.update({
					step: 'result',
					cancelling: false,
					result: this.state.cancelling
						? this.cancelledResult(action.command)
						: {
								success: false,
								command: action.command,
								error: error instanceof Error ? error.message : String(error),
								errorCode: 'DIAGNOSTIC_FAILED',
							},
				})
		} finally {
			if (this.activeExecution === execution) this.activeExecution = undefined
			if (epoch === this.operationEpoch) clearInterval(this.elapsedTimer)
		}
	}

	private cancelOperation() {
		++this.operationEpoch
		clearInterval(this.elapsedTimer)
		this.runAbort?.abort()
	}

	private cancelledResult(command: string): OutputData {
		return {
			success: false,
			command,
			error: '已停止等待并完成连接清理',
			errorCode: 'CANCELLED',
			suggestion: '目标操作可能已完成或仍在目标端运行；请检查进程状态和诊断文件。',
		}
	}

	cancelRun() {
		if (this.state.step !== 'running' || this.state.cancelling) return
		// Abort 只发出取消请求；owned Inspector 清理完成前不能复用同一调试端口。
		this.update({ cancelling: true, progress: '正在取消，等待连接与资源清理' })
		this.runAbort?.abort()
	}

	retry() {
		if (this.state.step === 'running' || this.state.closing) return
		this.update({
			step: 'collect',
			workspaceArea: 'parameters',
			error: undefined,
			scroll: 0,
			focus: 'parameters',
			fieldIndex: 0,
		})
		this.startSampling()
	}

	back() {
		if (this.state.help) {
			this.update({ help: false })
			return
		}
		if (this.state.searching) {
			this.update({ searching: false })
			return
		}
		if (this.state.step === 'running') {
			this.cancelRun()
			return
		}
		if (this.state.step === 'select') {
			this.update({ expanded: false, query: '', processIndex: 0 })
			return
		}
		if (this.state.step === 'status' && this.state.workspaceArea && this.state.workspaceArea !== 'overview') {
			this.update({ workspaceArea: 'overview', focus: 'actions', scroll: 0 })
			return
		}
		if (this.state.step === 'status' || !this.state.selected) {
			this.switchProcess()
			return
		}
		this.update({ step: 'status', workspaceArea: 'overview', error: undefined, scroll: 0, focus: 'actions' })
		this.startSampling()
	}

	switchProcess() {
		if (this.state.step === 'running' || this.state.closing) return
		this.stopSampling()
		this.cancelOperation()
		this.update({
			step: 'select',
			selected: undefined,
			samples: [],
			result: undefined,
			error: undefined,
			scroll: 0,
			expanded: false,
			searching: false,
		})
		void this.refreshProcesses()
	}

	setQuery(query: string) {
		this.update({ query, processIndex: 0 })
	}
	search() {
		this.update({ searching: true })
	}
	stopSearch() {
		this.update({ searching: false })
	}
	toggleHelp() {
		this.update({ help: !this.state.help, scroll: 0 })
	}
	toggleExpanded() {
		this.update({ expanded: !this.state.expanded, scroll: 0 })
	}
	scroll(delta: number, bounds?: { current: number; max: number }) {
		this.update({
			scroll: Math.max(
				0,
				Math.min(bounds?.max ?? Number.MAX_SAFE_INTEGER, (bounds?.current ?? this.state.scroll) + delta)
			),
			manualScroll: true,
		})
	}
	async refreshArtifacts() {
		if (this.state.closing) return
		try {
			const result = await this.dependencies.execute('history', {}, { pid: 0, recordHistory: false, timeout: 5000 })
			if (!result.success) {
				this.update({ artifactWarning: result.error ?? '无法读取诊断记录' })
				return
			}
			const records = Array.isArray(result.data?.records) ? result.data.records : []
			const artifacts: RecentArtifact[] = records.flatMap(
				(record: { artifacts?: unknown[]; command?: string; timestamp?: string; dataSource?: string; pid?: number }) =>
					(record.artifacts ?? [])
						.filter((path): path is string => typeof path === 'string')
						.map((path) => ({
							path,
							command: record.command ?? '未记录',
							timestamp: record.timestamp ?? '',
							source: record.dataSource ?? '未记录',
							pid: record.pid,
						}))
			)
			this.update({ artifacts, artifactWarning: undefined })
		} catch (error) {
			this.update({ artifactWarning: error instanceof Error ? error.message : String(error) })
		}
	}

	cycleWorkspaceTab(delta: number) {
		const tabs: WorkspaceTab[] = ['overview', 'cpu', 'memory', 'errors', 'timers', 'artifacts']
		this.setWorkspaceTab(
			tabs[(tabs.indexOf(this.state.workspaceTab ?? 'overview') + delta + tabs.length) % tabs.length]
		)
	}

	setWorkspaceTab(tab: WorkspaceTab) {
		if (this.state.step === 'running' || this.state.closing) return
		const actionId = (
			{ cpu: 'cpuprofile', memory: 'memory', errors: 'errors', timers: 'timers', artifacts: 'artifacts' } as Record<
				string,
				string
			>
		)[tab]
		const actionIndex = actionId ? actions.findIndex((action) => action.id === actionId) : this.state.actionIndex
		this.update({
			workspaceTab: tab,
			workspaceArea: 'overview',
			actionIndex,
			fields: { ...actions[actionIndex].defaults },
			fieldIndex: 0,
			scroll: 0,
		})
		if (tab === 'artifacts') void this.refreshArtifacts()
	}

	toggleFocus(delta = 1) {
		if (this.state.step === 'select') {
			this.update({ searching: !this.state.searching })
			return
		}
		const areas: WorkspaceArea[] = ['overview', 'tasks', 'parameters', 'artifacts']
		const area = this.state.workspaceArea ?? 'overview'
		const count = Object.keys(this.state.fields).length
		if (
			area === 'parameters' &&
			((delta > 0 && this.state.fieldIndex < count - 1) || (delta < 0 && this.state.fieldIndex > 0))
		) {
			this.update({ fieldIndex: this.state.fieldIndex + delta, scroll: 0 })
			return
		}
		const next = areas[(areas.indexOf(area) + delta + areas.length) % areas.length]
		this.update({
			workspaceArea: next,
			focus: next === 'parameters' ? 'parameters' : 'actions',
			fieldIndex: delta > 0 ? 0 : Math.max(0, count - 1),
			scroll: 0,
		})
	}

	moveSelection(delta: number) {
		if (this.state.step === 'running' || this.state.closing) return
		if (this.state.workspaceArea === 'parameters' && this.state.step !== 'select') {
			const count = Object.keys(this.state.fields).length
			this.update({ fieldIndex: (this.state.fieldIndex + delta + count) % count, scroll: 0 })
			return
		}
		if (this.state.step === 'select') {
			const count = filterProcesses(this.state.processes, this.state.query).length
			this.update({ scroll: 0, processIndex: count ? (this.state.processIndex + delta + count) % count : 0 })
		} else if (
			this.state.step === 'status' ||
			(this.state.step === 'collect' && this.state.focus === 'actions') ||
			(this.state.step === 'result' && this.state.workspaceArea === 'tasks')
		) {
			const resumeSampling = this.state.step === 'result'
			const actionIndex = (this.state.actionIndex + delta + actions.length) % actions.length
			this.update({
				step: resumeSampling ? 'collect' : this.state.step,
				workspaceArea: 'tasks',
				focus: 'actions',
				scroll: 0,
				actionIndex,
				fields: { ...actions[actionIndex].defaults },
				fieldIndex: 0,
				error: undefined,
			})
			// 上次诊断已清理完成；选择下一任务后恢复被动采样，避免继续显示执行前的旧指标。
			if (resumeSampling) this.startSampling()
		} else if (this.state.step === 'collect') {
			const count = Object.keys(this.state.fields).length
			this.update({ scroll: 0, fieldIndex: (this.state.fieldIndex + delta + count) % count })
		} else this.scroll(delta)
	}

	// 退出等待活动诊断与被动 Inspector 采样收敛，避免宿主结束时打断 owned 连接清理。
	shutdown(): Promise<void> {
		if (this.closingPromise) return this.closingPromise
		this.update({ closing: true, cancelling: this.state.step === 'running', progress: '正在退出，等待连接与资源清理' })
		this.stopSampling()
		this.runAbort?.abort()
		const pending: Promise<unknown>[] = []
		if (this.activeExecution) pending.push(this.activeExecution)
		if (this.activeSampling) pending.push(this.activeSampling)
		this.closingPromise = Promise.allSettled(pending).then(() => {
			this.dispose()
		})
		return this.closingPromise
	}

	dispose() {
		this.stopSampling()
		this.cancelOperation()
		this.disposed = true
		this.listeners.clear()
	}
}

import { clearInterval as nativeClearInterval, setInterval as nativeSetInterval } from 'node:timers'
import type { Subscription } from 'rxjs'
import { initAgent } from './binary'
import type { TimeoutCollector } from './collector/timeout'
import { DEFAULT_MITO_NODE_OPTION, initConfig, initOption, preCheck, SyncToAgent } from './init'
import { AgentRequestError, heartbeatToAgent, requestToAgent, unregisterProcessFromAgent } from './request'
import { logger, MITO_NODE, SubjectNames } from './shared'
import { CPUSubject, JSErrorSubject, MemorySubject, TimeoutSubject } from './subjects'
import type { BaseMonitoringSubject } from './subjects/base'
import type { MitoNodeOption } from './types'

export class MitoNode {
	private readonly _options: MitoNodeOption
	private _startPromise: Promise<void> | null = null
	private _destroyPromise: Promise<void> | null = null
	private _subjects: BaseMonitoringSubject<any>[] = []
	private _subscriptions: Subscription[] = []
	private _abort: AbortController | null = null
	private _heartbeat: NodeJS.Timeout | null = null
	private _inflight = new Set<Promise<unknown>>()
	private _pendingSubjects = new Set<string>()
	private _active = false
	private _ownsRegistration = false
	private _heartbeatPending = false
	constructor(options?: MitoNodeOption) {
		if (!global[MITO_NODE]) initConfig()
		this._options = initOption(options || DEFAULT_MITO_NODE_OPTION)
	}
	private registration() {
		const subjects: string[] = []
		const intervals: Record<string, number> = {}
		for (const [name, config] of Object.entries(this._options.metrics || {})) {
			if (config === false || config === undefined) continue
			subjects.push(name)
			intervals[name] =
				name === SubjectNames.JSError ? 30000 : typeof config === 'object' ? config.interval || 5000 : 5000
		}
		return { subjects, intervals }
	}
	// 并发 start 共用一次事务；失败会释放进程锁，调用者可修复配置后重试。
	start(): Promise<void> {
		if (this._active) return Promise.resolve()
		if (this._startPromise) return this._startPromise
		this._startPromise = this.startTransaction().finally(() => {
			this._startPromise = null
		})
		return this._startPromise
	}
	private async startTransaction() {
		if (this._destroyPromise) await this._destroyPromise
		preCheck()
		this._abort = new AbortController()
		try {
			initConfig()
			await initAgent()
			const { subjects, intervals } = this.registration()
			// 注册可能已落地但响应丢失，失败回滚仍应发送幂等注销。
			this._ownsRegistration = true
			await SyncToAgent(subjects, intervals, this._abort.signal)
			this.initializeSubjects()
			this._active = true
			;(globalThis as any).__MITO_NODE_ACTIVE__ = true
			this._heartbeat = nativeSetInterval(() => {
				void this.heartbeat()
			}, 30000)
			this._heartbeat.unref()
		} catch (error) {
			await this.cleanup()
			throw error
		}
	}
	private track<T>(promise: Promise<T>): Promise<T> {
		this._inflight.add(promise)
		void promise.finally(() => this._inflight.delete(promise)).catch(() => {})
		return promise
	}
	private initializeSubjects() {
		const constructors = {
			[SubjectNames.CPU]: CPUSubject,
			[SubjectNames.Memory]: MemorySubject,
			[SubjectNames.JSError]: JSErrorSubject,
			[SubjectNames.Timeout]: TimeoutSubject,
		}
		const { subjects, intervals } = this.registration()
		for (const name of subjects) {
			const Subject = constructors[name as SubjectNames]
			if (!Subject) continue
			const subject = new Subject({ interval: intervals[name] })
			this._subjects.push(subject)
			this._subscriptions.push(
				subject.subscribe((data: any) => {
					// 每个指标最多一条在途请求，Agent 失联时丢弃旧样本，避免无界堆积。
					if (this._abort?.signal.aborted || this._pendingSubjects.has(name)) return
					this._pendingSubjects.add(name)
					this.track(
						requestToAgent('/metrics/push', {
							method: 'POST',
							body: JSON.stringify({
								pid: process.pid,
								subject: name,
								data,
								truncated:
									name === SubjectNames.Timeout
										? { timers: (subject.getCollector() as unknown as TimeoutCollector)?.getDroppedCount() || 0 }
										: undefined,
							}),
							signal: this._abort?.signal,
						})
					)
						.catch((error: Error) => logger.debug('sendMetricsToAgent failed:', error.message))
						.finally(() => this._pendingSubjects.delete(name))
				})
			)
		}
		for (const subject of this._subjects) subject.start()
	}
	private async heartbeat() {
		if (!this._active || this._heartbeatPending) return
		this._heartbeatPending = true
		const controller = this._abort
		try {
			await this.track(heartbeatToAgent(this._abort?.signal))
		} catch (error) {
			if (!this._abort?.signal.aborted) {
				try {
					// Agent 重启后原注册丢失，下一轮心跳恢复注册；端口身份仍由 initAgent 校验。
					await initAgent()
					// destroy 可能已在 daemon 启动期间完成，旧恢复任务不得重新注册。
					if (!this._active || controller !== this._abort || controller?.signal.aborted) return
					const { subjects, intervals } = this.registration()
					if (!(error instanceof AgentRequestError) || error.status === 404)
						await this.track(SyncToAgent(subjects, intervals, this._abort?.signal))
				} catch (retryError) {
					logger.debug('heartbeat recovery failed:', retryError)
				}
			}
		} finally {
			this._heartbeatPending = false
		}
	}
	// 仅注销当前 SDK 的 PID，不能关闭其他应用共享的 daemon。
	destroy(): Promise<void> {
		if (this._destroyPromise) return this._destroyPromise
		this._destroyPromise = (async () => {
			if (this._startPromise) {
				try {
					await this._startPromise
				} catch {}
			}
			await this.cleanup()
		})().finally(() => {
			this._destroyPromise = null
		})
		return this._destroyPromise
	}
	private async cleanup() {
		if (!this._abort && !this._ownsRegistration) return
		this._active = false
		if (this._heartbeat) nativeClearInterval(this._heartbeat)
		this._heartbeat = null
		this._abort?.abort()
		for (const subscription of this._subscriptions) subscription.unsubscribe()
		for (const subject of this._subjects) if (!subject.closed) subject.unsubscribe()
		this._subjects = []
		this._subscriptions = []
		await Promise.allSettled([...this._inflight])
		this._pendingSubjects.clear()
		if (this._ownsRegistration) {
			try {
				await unregisterProcessFromAgent()
			} catch (error) {
				logger.debug('unregister failed:', error)
			}
		}
		this._ownsRegistration = false
		this._abort = null
		global[MITO_NODE] = false
		;(globalThis as any).__MITO_NODE_ACTIVE__ = false
	}
}

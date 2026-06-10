import type { Subscription } from 'rxjs'
import { sendMetricToAgent } from './agent'
import { initAgent, type MitojsAgent } from './binary'
import {
	DEFAULT_MITO_NODE_OPTION,
	initConfig,
	initOption,
	initProxyThread,
	type ProxyThread,
	preCheck,
	SyncToAgent,
} from './init'
import { logger, SubjectNames } from './shared'
import { CPUSubject, JSErrorSubject, MemorySubject, TimeoutSubject } from './subjects'
import type { BaseMonitoringSubject } from './subjects/base'
import type { MitoNodeOption } from './types'

function isMetricEnabled(options: MitoNodeOption, subjectName: SubjectNames) {
	return options.metrics?.[subjectName] !== false
}

function initSubjects(options: MitoNodeOption) {
	const SUBJECTS = [
		{ name: SubjectNames.CPU, Subject: CPUSubject },
		{ name: SubjectNames.Memory, Subject: MemorySubject },
		{ name: SubjectNames.JSError, Subject: JSErrorSubject },
		{ name: SubjectNames.Timeout, Subject: TimeoutSubject },
	]
	const subscriptions: Subscription[] = []
	const subjects: BaseMonitoringSubject<any>[] = []
	SUBJECTS.filter(({ name }) => isMetricEnabled(options, name)).forEach(({ name, Subject }) => {
		const subject = new Subject()
		subjects.push(subject)
		const subscription = subject.subscribe((data) => {
			void sendMetricToAgent(name, data).catch((error) => {
				logger.error('send metric to agent error', error)
			})
		})
		subscriptions.push(subscription)
	})

	subjects.forEach((subject) => {
		subject.start()
	})

	return () => {
		// ReactiveSubject 会自动检测，是否有订阅者，没有则会自动关闭并执行 teardown 销毁函数
		subscriptions.forEach((subscription) => {
			subscription.unsubscribe()
		})
	}
}

export class MitoNode {
	private _options: MitoNodeOption = DEFAULT_MITO_NODE_OPTION
	private _unsubscribe: (() => void) | undefined
	private _agent: MitojsAgent | undefined
	private _proxyThread: ProxyThread | undefined
	constructor(options?: MitoNodeOption) {
		initConfig()
		this._options = initOption(options)
	}

	async start() {
		preCheck()
		try {
			// 初始化agent
			this._agent = await initAgent()
			logger.info('rust agent started successfully')
			// 通过 work_thread

			this._proxyThread = await initProxyThread()
			await SyncToAgent({ proxyPort: this._proxyThread?.port })
			// 初始化 subject ，可动态配置开启和关闭，并通过 uds 传输给 rust agent
			this._unsubscribe = initSubjects(this._options)
		} catch (error) {
			await this._agent?.stop().catch((stopError) => {
				logger.error('stop MitoNode agent after start error', stopError)
			})
			await this._proxyThread?.worker.terminate().catch((workerError) => {
				logger.error('terminate MitoNode proxy worker after start error', workerError)
			})
			this._agent = undefined
			this._proxyThread = undefined
			logger.error('start MitoNode error', error)
		}
	}

	async destroy() {
		this._unsubscribe?.()
		this._unsubscribe = undefined
		await this._proxyThread?.worker.terminate()
		this._proxyThread = undefined
		await this._agent?.stop()
		this._agent = undefined
	}
}

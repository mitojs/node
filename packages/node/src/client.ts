import type { Subscription } from 'rxjs'
import { initAgent } from './binary'
import { DEFAULT_MITO_NODE_OPTION, initConfig, initOption, initProxyThread, preCheck } from './init'
import { logger } from './shared'
import { CPUSubject, JSErrorSubject, MemorySubject } from './subjects'
import type { BaseMonitoringSubject } from './subjects/base'
import type { MitoNodeOption } from './types'

function initSubjects() {
	// todo 这里的插件可以通过参数来传入
	const SUBJECTS = [CPUSubject, MemorySubject, JSErrorSubject]
	// 收集完指标后发送给 agent
	const subscriptions: Subscription[] = []
	const subjects: BaseMonitoringSubject<any>[] = []
	SUBJECTS.forEach((Subject) => {
		const subject = new Subject()
		subjects.push(subject)
		const subscription = subject.subscribe((data) => {
			// 通过 uds 与 rust agent 通信
			const name = subject.getSubjectName()
			logger.info('name', name, 'data', data)
		})
		subscriptions.push(subscription)
	})

	const intervalSwitch = (status: boolean) => {
		subjects.forEach((subject) => {
			status ? subject.start() : subject.clearTimer()
		})
	}

	// 监听 Rust 发送过来的消息来打开关闭
	// getUds().listen()
	// subjects.forEach((subject) => {
	// 	subject.start()
	// })

	return () => {
		// ReactiveSubject 会自动检测，是否有订阅者，没有则会自动关闭并执行 teardown 销毁函数
		subscriptions.forEach((subscription) => {
			subscription.unsubscribe()
		})
	}
}

export class MitoNode {
	private _options: MitoNodeOption = DEFAULT_MITO_NODE_OPTION
	constructor(options?: MitoNodeOption) {
		initConfig()
		this._options = initOption(options)
	}

	async start() {
		preCheck()
		try {
			// 初始化agent
			await initAgent()
			logger.info('rust agent started successfully')
			// 通过 work_thread

			await initProxyThread()
			// await this.registerProcessToAgent();
			// 初始化 subject ，可动态配置开启和关闭，并通过 uds 传输给 rust agent
			// 初始化插件
			// const unsubscribe = initSubjects()
		} catch (error) {
			logger.error('start MitoNode error', error)
		}
	}

	destroy() {
		// 关闭 subject ，并通过 uds 传输给 rust agent
	}
}

const mitoNode = new MitoNode()
mitoNode.start()

setTimeout(() => {}, 1000000)

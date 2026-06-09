import type { Subscription } from 'rxjs'
import { initAgent } from './binary'
import { DEFAULT_MITO_NODE_OPTION, initConfig, initOption, initProxyThread, preCheck } from './init'
import { requestToAgent } from './request'
import { logger } from './shared'
import { CPUSubject, JSErrorSubject, MemorySubject } from './subjects'
import type { BaseMonitoringSubject } from './subjects/base'
import type { MitoNodeOption } from './types'

function sendMetricsToAgent(subject: string, data: any) {
	requestToAgent('/metrics/push', {
		method: 'POST',
		body: JSON.stringify({ pid: process.pid, subject, data }),
	}).catch((e) => {
		logger.debug('sendMetricsToAgent failed:', e.message)
	})
}

function initSubjects() {
	const SUBJECTS = [CPUSubject, MemorySubject, JSErrorSubject]
	const subscriptions: Subscription[] = []
	const subjects: BaseMonitoringSubject<any>[] = []
	SUBJECTS.forEach((Subject) => {
		const subject = new Subject()
		subjects.push(subject)
		const subscription = subject.subscribe((data) => {
			const name = subject.getSubjectName()
			sendMetricsToAgent(name, data)
		})
		subscriptions.push(subscription)
	})

	subjects.forEach((subject) => {
		subject.start()
	})

	return () => {
		subscriptions.forEach((subscription) => {
			subscription.unsubscribe()
		})
	}
}

export class MitoNode {
	private _options: MitoNodeOption = DEFAULT_MITO_NODE_OPTION
	private _unsubscribe: (() => void) | null = null

	constructor(options?: MitoNodeOption) {
		initConfig()
		this._options = initOption(options)
	}

	async start() {
		preCheck()
		try {
			await initAgent()
			logger.info('rust agent started successfully')
			await initProxyThread()
			// 设置全局 flag，CLI 可通过此标志判断 SDK 是否已加载
			;(globalThis as any).__MITO_NODE_ACTIVE__ = true
			this._unsubscribe = initSubjects()
			logger.info('subjects initialized, metrics streaming to agent')
		} catch (error) {
			logger.error('start MitoNode error', error)
		}
	}

	destroy() {
		if (this._unsubscribe) {
			this._unsubscribe()
			this._unsubscribe = null
		}
		;(globalThis as any).__MITO_NODE_ACTIVE__ = false
	}
}

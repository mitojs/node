import type { Subscription } from 'rxjs'
import { initAgent } from './binary'
import { DEFAULT_MITO_NODE_OPTION, initConfig, initOption, initProxyThread, preCheck, SyncToAgent } from './init'
import { requestToAgent } from './request'
import { logger, SubjectNames } from './shared'
import { CPUSubject, JSErrorSubject, MemorySubject, TimeoutSubject } from './subjects'
import type { BaseMonitoringSubject } from './subjects/base'
import type { MetricConfig, MitoNodeOption } from './types'

function sendMetricsToAgent(subject: string, data: any) {
	requestToAgent('/metrics/push', {
		method: 'POST',
		body: JSON.stringify({ pid: process.pid, subject, data }),
	}).catch((e) => {
		logger.debug('sendMetricsToAgent failed:', e.message)
	})
}

function getInterval(config: MetricConfig | undefined): number | undefined {
	if (typeof config === 'object' && config.interval) {
		return config.interval
	}
	return undefined
}

function isEnabled(config: MetricConfig | undefined): boolean {
	if (config === undefined || config === false) return false
	return true
}

function initSubjects(options: MitoNodeOption) {
	const metrics = options.metrics || {}
	const subscriptions: Subscription[] = []
	const subjects: BaseMonitoringSubject<any>[] = []

	const subjectConfigs: Array<{
		Subject: new (opts?: { interval: number }) => BaseMonitoringSubject<any>
		name: SubjectNames
		config: MetricConfig | undefined
	}> = [
		{ Subject: CPUSubject, name: SubjectNames.CPU, config: metrics[SubjectNames.CPU] },
		{ Subject: MemorySubject, name: SubjectNames.Memory, config: metrics[SubjectNames.Memory] },
		{ Subject: JSErrorSubject, name: SubjectNames.JSError, config: metrics[SubjectNames.JSError] },
		{ Subject: TimeoutSubject, name: SubjectNames.Timeout, config: metrics[SubjectNames.Timeout] },
	]

	for (const { Subject, config } of subjectConfigs) {
		if (!isEnabled(config)) continue

		const interval = getInterval(config)
		const subject = interval ? new Subject({ interval }) : new Subject()
		subjects.push(subject)
		const subscription = subject.subscribe((data) => {
			const name = subject.getSubjectName()
			sendMetricsToAgent(name, data)
		})
		subscriptions.push(subscription)
	}

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
			await SyncToAgent()
			await initProxyThread()
			// 设置全局 flag，CLI 可通过此标志判断 SDK 是否已加载
			;(globalThis as any).__MITO_NODE_ACTIVE__ = true
			this._unsubscribe = initSubjects(this._options)
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

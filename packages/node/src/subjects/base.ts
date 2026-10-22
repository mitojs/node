import type { BaseCollector } from '../collector/base'
import { logger, type SubjectNames } from '../shared'
import { ReactiveSubject } from '../shared/ReactiveSubject'

/**
 * Base class for monitoring subjects that collect data at regular intervals
 */
export abstract class BaseMonitoringSubject<T> extends ReactiveSubject<T> {
	protected _interval: number
	protected _timer: NodeJS.Timeout | null = null
	protected scheduleInterval: typeof setInterval
	protected collector: BaseCollector<T> | null = null

	constructor(options?: { interval: number }) {
		super()
		this._interval = options?.interval || 5000
		// 捕获业务定时器包装前的函数，避免 SDK 自己的采样定时器污染业务快照。
		this.scheduleInterval = global.setInterval
		this.collector = this.createCollector()
		this.addTearDown(() => {
			this.teardown()
		})
	}

	/**
	 * Abstract method to create the specific collector instance
	 */
	protected abstract createCollector(): BaseCollector<T>

	/**
	 * Get the subject name
	 */
	abstract getSubjectName(): SubjectNames

	getCollector() {
		return this.collector
	}

	/**
	 * Start the monitoring timer
	 */
	start(options?: { interval: number }) {
		if (options?.interval) {
			this._interval = options.interval
		}
		this.clearTimer()
		if (this.closed) {
			logger.error(`${this.getSubjectName()} start error, subject is closed`)
			return
		}
		this._timer = this.scheduleInterval(() => {
			const data = this.collector!.get()
			if (data) {
				this.next(data)
			}
		}, this._interval)
		this._timer.unref?.()
	}

	/**
	 * Clear the current timer
	 */
	clearTimer() {
		this._timer && clearInterval(this._timer)
		this._timer = null
	}

	/**
	 * Clean up resources
	 */
	teardown() {
		this.clearTimer()
		this.collector?.destroy()
		this.collector = null
	}
}

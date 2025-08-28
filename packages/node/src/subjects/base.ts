import type { BaseCollector } from '../collector/base'
import { logger, type SubjectNames } from '../shared'
import { ReactiveSubject } from '../shared/ReactiveSubject'

/**
 * Base class for monitoring subjects that collect data at regular intervals
 */
export abstract class BaseMonitoringSubject<T> extends ReactiveSubject<T> {
	protected _interval: number
	protected _timer: NodeJS.Timeout | null = null
	protected collector: BaseCollector<T> | null = null

	constructor(options?: { interval: number }) {
		super()
		this._interval = options?.interval || 5000
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
		this._timer = setInterval(() => {
			const data = this.collector!.get()
			if (data) {
				this.next(data)
			}
		}, this._interval)
	}

	/**
	 * Clear the current timer
	 */
	clearTimer() {
		this._timer && clearInterval(this._timer)
	}

	/**
	 * Clean up resources
	 */
	teardown() {
		this.clearTimer()
		this.collector = null
	}
}

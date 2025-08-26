import type { BaseCollector } from '../collector/base'
import { logger } from '../shared'
import { ReactiveSubject } from '../shared/ReactiveSubject'

/**
 * Base class for monitoring subjects that collect data at regular intervals
 */
export abstract class BaseMonitoringSubject<T> extends ReactiveSubject<T> {
	protected _interval: number = 5000
	protected _timer: NodeJS.Timeout | null = null
	protected collector: BaseCollector<T> | null = null

	constructor({ interval }: { interval: number }) {
		super()
		this._interval = interval
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
	 * Get the subject name for logging purposes
	 */
	protected abstract getSubjectName(): string

	getCollector() {
		return this.collector
	}

	/**
	 * Start the monitoring timer
	 */
	start() {
		if (this.closed) {
			logger.error(`${this.getSubjectName()} start error, subject is closed`)
			return
		}
		this._timer = setInterval(() => {
			this.next(this.collector!.get())
		}, this._interval)
	}

	/**
	 * Update the interval and restart the monitoring
	 */
	updateAndRestart(options: { interval: number }) {
		this._interval = options.interval
		this.clearTimer()
		this.start()
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

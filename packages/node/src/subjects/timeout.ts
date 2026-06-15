import type { BaseCollector } from '../collector/base'
import { TimeoutCollector, type TimeoutData } from '../collector/timeout'
import { SubjectNames } from '../shared'
import { BaseMonitoringSubject } from './base'

export type SerializedTimeoutData = Array<{
	id: number
	name: string
	stack: string
	destroyed: boolean
}>

export class TimeoutSubject extends BaseMonitoringSubject<SerializedTimeoutData> {
	protected createCollector(): BaseCollector<SerializedTimeoutData> {
		// TimeoutCollector 的 listen() 会在 BaseCollector 构造函数中自动调用，劫持 setTimeout/setInterval
		return new TimeoutCollector() as unknown as BaseCollector<SerializedTimeoutData>
	}

	getSubjectName() {
		return SubjectNames.Timeout
	}

	// Map 无法直接 JSON.stringify，需转为数组
	start(options?: { interval: number }) {
		if (options?.interval) {
			this._interval = options.interval
		}
		this.clearTimer()
		if (this.closed) {
			return
		}
		this._timer = setInterval(() => {
			const rawData = (this.collector as unknown as TimeoutCollector)?.get()
			if (rawData && rawData.size > 0) {
				const serialized: SerializedTimeoutData = []
				for (const [id, info] of rawData.entries()) {
					serialized.push({
						id,
						name: info.name,
						stack: info.stack,
						destroyed: info.timer._destroyed ?? false,
					})
				}
				this.next(serialized)
			}
		}, this._interval)
	}
}

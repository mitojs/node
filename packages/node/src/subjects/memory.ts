import { MemoryCollector, type MemoryData } from '../collector/memory'
import { logger } from '../shared'
import { ReactiveSubject } from '../shared/ReactiveSubject'

export class MemorySubject extends ReactiveSubject<MemoryData> {
	private _timer: NodeJS.Timeout | null = null
	private _interval: number = 1000
	private memoryCollector: MemoryCollector | null = null
	constructor() {
		super()
		this.memoryCollector = new MemoryCollector()
	}
	start() {
		if (this.closed) {
			logger.error('MemorySubject start error, subject is closed')
			return
		}
		this._timer = setInterval(() => {
			this.next(this.memoryCollector!.getData())
		}, this._interval)
	}

	clearTimer() {
		this._timer && clearInterval(this._timer)
	}
}

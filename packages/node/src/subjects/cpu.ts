import { CPUCollector } from '../collector/cpu'
import { logger } from '../shared'
import { ReactiveSubject } from '../shared/ReactiveSubject'

class CPUSubject extends ReactiveSubject<{
	userPercent: number
	systemPercent: number
}> {
	private _interval: number = 5000
	private cpuCollector: CPUCollector | null = null
	private _timer: NodeJS.Timeout | null = null
	constructor() {
		super()
		this.cpuCollector = new CPUCollector()
		this.addTearDown(() => {
			this.teardown()
		})
	}

	start() {
		if (this.closed) {
			logger.error('CPUSubject start error, subject is closed')
			return
		}
		this._timer = setInterval(() => {
			this.next(this.cpuCollector!.getData())
		}, this._interval)
	}

	updateAndRestart(options: { interval: number }) {
		this._interval = options.interval
		this.clearTimer()
		this.start()
	}

	clearTimer() {
		this._timer && clearInterval(this._timer)
	}

	teardown() {
		this.clearTimer()
		this.cpuCollector = null
	}
}
const cpuSubject = new CPUSubject()
cpuSubject.start()
cpuSubject.subscribe((data) => {
	console.log('cpuSubject', data)
})
setTimeout(() => {
	cpuSubject.updateAndRestart({ interval: 1000 })
}, 10000)

setTimeout(() => {}, 100000000000)

import { cpuUsage, hrtime } from 'node:process'
import { logger } from '../shared'
import { ReactiveSubject } from '../shared/ReactiveSubject'

class CPUMetrics {
	private _lastHrtime: bigint
	private _lastCpuUsage: NodeJS.CpuUsage
	constructor() {
		this._lastHrtime = hrtime.bigint()
		this._lastCpuUsage = cpuUsage()
	}

	public getMetrics() {
		const currentCpuUsage = cpuUsage()
		const timeDiff = Number(hrtime.bigint() - this._lastHrtime) / 1e9
		const userDiff = currentCpuUsage.user - this._lastCpuUsage.user
		const systemDiff = currentCpuUsage.system - this._lastCpuUsage.system
		const userPercent = (userDiff / timeDiff) * 100
		const systemPercent = (systemDiff / timeDiff) * 100
		this._lastCpuUsage = currentCpuUsage
		this._lastHrtime = hrtime.bigint()
		return {
			userPercent,
			systemPercent,
		}
	}
}

class CPUSubject extends ReactiveSubject<{
	userPercent: number
	systemPercent: number
}> {
	private _interval: number = 5000
	private cpuMetrics: CPUMetrics | null = null
	private _timer: NodeJS.Timeout | null = null
	constructor() {
		super()
		this.cpuMetrics = new CPUMetrics()
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
			this.next(this.cpuMetrics!.getMetrics())
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
		this.cpuMetrics = null
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

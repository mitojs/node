import { cpuUsage, hrtime } from 'node:process'

export class CPUCollector {
	private _lastHrtime: bigint
	private _lastCpuUsage: NodeJS.CpuUsage
	constructor() {
		this._lastHrtime = hrtime.bigint()
		this._lastCpuUsage = cpuUsage()
	}

	public getData() {
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

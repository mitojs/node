import { cpuUsage, hrtime } from 'node:process'

export class CPUCollector {
	private _lastHrtime: bigint
	private _lastCpuUsage: NodeJS.CpuUsage
	constructor() {
		// nanoseconds
		this._lastHrtime = hrtime.bigint()
		// microsecond
		this._lastCpuUsage = cpuUsage()
	}

	public getData() {
		const currentCpuUsage = cpuUsage()
		// nanoseconds 转成 microsecond
		const timeDiff = Number(hrtime.bigint() - this._lastHrtime) / 1e3
		const userDiff = currentCpuUsage.user - this._lastCpuUsage.user
		const systemDiff = currentCpuUsage.system - this._lastCpuUsage.system

		const load = ((userDiff + systemDiff) / timeDiff) * 100
		const useLoad = (userDiff / timeDiff) * 100

		this._lastHrtime = hrtime.bigint()
		this._lastCpuUsage = currentCpuUsage
		return {
			load,
			useLoad,
		}
	}
}

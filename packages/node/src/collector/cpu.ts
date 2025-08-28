import { cpuUsage, hrtime } from 'node:process'
import { BaseCollector } from './base'

export interface CPUData {
	load: number
	useLoad: number
}

export class CPUCollector extends BaseCollector<CPUData> {
	private _lastHrtime: bigint
	private _lastCpuUsage: NodeJS.CpuUsage
	constructor() {
		super()
		// nanoseconds
		this._lastHrtime = hrtime.bigint()
		// microsecond
		this._lastCpuUsage = cpuUsage()
	}

	public get() {
		// todo 通过 Rust 获取 getThreadCPUUsage
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

	destroy() {
		super.destroy()
		this._lastHrtime = 0n
		this._lastCpuUsage = {
			user: 0,
			system: 0,
		}
	}
}

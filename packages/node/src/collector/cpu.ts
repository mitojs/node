import { cpuUsage, hrtime } from 'node:process'
import { calculateCpuPercent } from '@mitojs/node-shared/recipes'
import type { CPUData } from '@mitojs/node-shared/types'
import { BaseCollector } from './base'

export type { CPUData } from '@mitojs/node-shared/types'

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
		const currentCpuUsage = cpuUsage()
		// nanoseconds 转成 microsecond
		const timeDiff = Number(hrtime.bigint() - this._lastHrtime) / 1e3
		const userDiff = currentCpuUsage.user - this._lastCpuUsage.user
		const systemDiff = currentCpuUsage.system - this._lastCpuUsage.system

		this._lastHrtime = hrtime.bigint()
		this._lastCpuUsage = currentCpuUsage
		return calculateCpuPercent(userDiff, systemDiff, timeDiff)
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

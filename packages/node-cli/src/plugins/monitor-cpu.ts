import { render } from 'ink'
import React from 'react'
import CPUGraph from '../CPUGraph.js'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { FUNCTION_WRAPPER } from '../helper.js'

export const monitorCpuPlugin: DiagnosticPlugin = {
	name: 'monitor-cpu',
	description: 'Real-time monitor CPU usage of the target process',
	async execute(ctx) {
		let lastCpuData: { user: number; system: number; hrtime: bigint } | null = null

		const getCPUData = async (): Promise<number> => {
			const data = await ctx.session.evaluate(
				FUNCTION_WRAPPER(`
					const usage = process.cpuUsage();
					const hrtime = process.hrtime.bigint();
					return { user: usage.user, system: usage.system, hrtime: hrtime.toString() };
				`)
			)
			const current = { user: data.user, system: data.system, hrtime: BigInt(data.hrtime) }
			if (!lastCpuData) {
				lastCpuData = current
				return 0
			}
			const timeDiff = Number(current.hrtime - lastCpuData.hrtime) / 1e3
			const userDiff = current.user - lastCpuData.user
			const systemDiff = current.system - lastCpuData.system
			lastCpuData = current
			if (timeDiff <= 0) return 0
			return Math.min(((userDiff + systemDiff) / timeDiff) * 100, 100)
		}

		if (ctx.json) {
			while (true) {
				try {
					const cpuPercent = await getCPUData()
					process.stdout.write(
						JSON.stringify({ success: true, command: 'monitor-cpu', data: { cpuPercent, timestamp: Date.now() } }) +
							'\n'
					)
				} catch {
					break
				}
				await new Promise((resolve) => setTimeout(resolve, 1000))
			}
		} else {
			render(React.createElement(CPUGraph, { getCPUData }))
			await new Promise(() => {})
		}

		return { success: true }
	},
}

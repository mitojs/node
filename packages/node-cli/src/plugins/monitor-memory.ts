import { render } from 'ink'
import React from 'react'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { FUNCTION_WRAPPER } from '../helper.js'
import MemoryGraph from '../MemoryGraph.js'

export const monitorMemoryPlugin: DiagnosticPlugin = {
	name: 'monitor-memory',
	description: 'Real-time monitor memory usage of the target process',
	async execute(ctx) {
		const getMemoryDataFromInspector = async () => {
			const data = await ctx.session.evaluate(
				FUNCTION_WRAPPER(`
					const mem = process.memoryUsage();
					return { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss };
				`)
			)
			return data
		}

		const getMemoryDataFromAgent = async () => {
			const metrics = await ctx.agentClient!.getMetrics(ctx.pid)
			if (metrics?.memory) {
				const mem = metrics.memory as any
				return {
					heapUsed: mem.heapUsed ?? mem.heap_used ?? 0,
					heapTotal: mem.heapTotal ?? mem.heap_total ?? 0,
					rss: mem.rss ?? 0,
				}
			}
			return getMemoryDataFromInspector()
		}

		const getMemoryData = ctx.agentClient ? getMemoryDataFromAgent : getMemoryDataFromInspector

		if (ctx.json) {
			while (true) {
				try {
					const memData = await getMemoryData()
					process.stdout.write(
						JSON.stringify({ success: true, command: 'monitor-memory', data: { ...memData, timestamp: Date.now() } }) +
							'\n'
					)
				} catch {
					break
				}
				await new Promise((resolve) => setTimeout(resolve, 2000))
			}
		} else {
			render(React.createElement(MemoryGraph, { getMemoryData }))
			await new Promise(() => {})
		}

		return { success: true }
	},
}

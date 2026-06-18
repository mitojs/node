import { getMemorySnapshotInjectable } from '@mitojs/node-shared/recipes'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { DataSource, ensureSession, FUNCTION_WRAPPER, ok } from '../helper.js'

export const monitorMemoryPlugin: DiagnosticPlugin = {
	name: 'monitor-memory',
	description: 'Monitor memory usage of the target process',
	async execute(ctx) {
		if (ctx.agentClient) {
			const metrics = await ctx.agentClient.getMetrics(ctx.pid)
			if (metrics?.memory) {
				const mem = metrics.memory as any
				return ok(
					{
						heapUsed: mem.heapUsed ?? mem.heap_used ?? 0,
						heapTotal: mem.heapTotal ?? mem.heap_total ?? 0,
						rss: mem.rss ?? 0,
					},
					DataSource.AGENT
				)
			}
		}

		const session = await ensureSession(ctx)
		const data = await session.evaluate(FUNCTION_WRAPPER(getMemorySnapshotInjectable()))
		return ok(data, DataSource.INSPECTOR)
	},
}

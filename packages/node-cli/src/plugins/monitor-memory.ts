import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession, FUNCTION_WRAPPER } from '../helper.js'

export const monitorMemoryPlugin: DiagnosticPlugin = {
	name: 'monitor-memory',
	description: 'Monitor memory usage of the target process',
	async execute(ctx) {
		if (ctx.agentClient) {
			const metrics = await ctx.agentClient.getMetrics(ctx.pid)
			if (metrics?.memory) {
				const mem = metrics.memory as any
				return {
					success: true,
					data: {
						heapUsed: mem.heapUsed ?? mem.heap_used ?? 0,
						heapTotal: mem.heapTotal ?? mem.heap_total ?? 0,
						rss: mem.rss ?? 0,
						source: 'agent',
					},
				}
			}
		}

		const session = await ensureSession(ctx)
		const data = await session.evaluate(
			FUNCTION_WRAPPER(`
				const mem = process.memoryUsage();
				return { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss };
			`)
		)
		return { success: true, data: { ...data, source: 'inspector' } }
	},
}

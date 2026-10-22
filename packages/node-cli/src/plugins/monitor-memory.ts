import { getMemorySnapshotInjectable } from '@mitojs/node-shared/recipes'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { DataSource, ensureSession, FUNCTION_WRAPPER, ok, readAgentMetrics } from '../helper.js'
export const monitorMemoryPlugin: DiagnosticPlugin = {
	name: 'monitor-memory',
	label: '查看内存使用',
	subject: 'Memory',
	description: 'Read one memory snapshot in bytes',
	async execute(ctx) {
		const metrics = await readAgentMetrics(ctx, 'Memory')
		if (metrics?.memory?.memory) {
			const { heapUsed, heapTotal, rss } = metrics.memory.memory
			return ok(
				{
					heapUsed,
					heapTotal,
					rss,
					sampledAt: ctx.processInfo?.updatedAt?.Memory,
					interval: ctx.processInfo?.intervals?.Memory,
				},
				DataSource.AGENT
			)
		}
		const session = await ensureSession(ctx)
		return ok(await session.evaluate(FUNCTION_WRAPPER(getMemorySnapshotInjectable())), DataSource.INSPECTOR)
	},
}

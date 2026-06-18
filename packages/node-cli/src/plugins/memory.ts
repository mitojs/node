import { getMemoryInjectable } from '@mitojs/node-shared/recipes'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { DataSource, ensureSession, FUNCTION_WRAPPER, ok } from '../helper.js'

export const memoryPlugin: DiagnosticPlugin = {
	name: 'memory',
	description: 'get memory info of the target process',
	async execute(ctx) {
		// 优先使用 Agent 通道（SDK 已采集的数据）
		if (ctx.agentClient) {
			const metrics = await ctx.agentClient.getMetrics(ctx.pid)
			if (metrics?.memory) {
				return ok(metrics.memory, DataSource.AGENT)
			}
		}
		// 回退到 Inspector 注入
		const session = await ensureSession(ctx)
		const data = await session.evaluate(FUNCTION_WRAPPER(getMemoryInjectable()))
		return ok(data, DataSource.INSPECTOR)
	},
}

import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession, FUNCTION_WRAPPER } from '../helper.js'

export const memoryPlugin: DiagnosticPlugin = {
	name: 'memory',
	description: 'get memory info of the target process',
	async execute(ctx) {
		// 优先使用 Agent 通道（SDK 已采集的数据）
		if (ctx.agentClient) {
			const metrics = await ctx.agentClient.getMetrics(ctx.pid)
			if (metrics?.memory) {
				return { success: true, data: { ...metrics.memory, source: 'agent' } }
			}
		}
		// 回退到 Inspector 注入
		const session = await ensureSession(ctx)
		const data = await session.evaluate(FUNCTION_WRAPPER(`return process.memoryUsage();`))
		return { success: true, data: { ...data, source: 'inspector' } }
	},
}

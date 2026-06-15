import type { DiagnosticPlugin } from '../core/plugin.js'
import { FUNCTION_WRAPPER } from '../helper.js'

export const timersPlugin: DiagnosticPlugin = {
	name: 'timers',
	description: 'List active timers (setTimeout/setInterval) with creation stack traces for leak detection',
	async execute(ctx) {
		// 优先使用 Agent 通道（SDK 已采集的定时器数据）
		if (ctx.agentClient) {
			const metrics = await ctx.agentClient.getMetrics(ctx.pid)
			if (metrics?.timers && Array.isArray(metrics.timers) && metrics.timers.length > 0) {
				return { success: true, data: { timers: metrics.timers, source: 'agent' } }
			}
		}

		// 回退到 Inspector 注入：检测 SDK 是否加载并读取内部数据
		const data = await ctx.session.evaluate(
			FUNCTION_WRAPPER(`
				if (globalThis.__MITO_NODE_ACTIVE__) {
					// SDK 已加载但 Agent 不可用时，尝试从全局获取定时器数据
					return { sdkActive: true, message: 'Timer data is available via Agent channel. Ensure Rust Agent is running.' };
				}
				// SDK 未加载，无法获取定时器信息
				return { sdkActive: false, message: 'Timer detection requires @mitojs/node SDK to be loaded in the target process.' };
			`)
		)

		if (data?.sdkActive === false) {
			return {
				success: false,
				error: data.message,
			}
		}

		return { success: true, data: { ...data, source: 'inspector' } }
	},
}

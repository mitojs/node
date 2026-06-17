import type { DiagnosticPlugin } from '../core/plugin.js'
import { DataSource, ensureSession, FUNCTION_WRAPPER, fail, ok } from '../helper.js'

export const timersPlugin: DiagnosticPlugin = {
	name: 'timers',
	description: 'List active timers (setTimeout/setInterval) with creation stack traces for leak detection',
	async execute(ctx) {
		// 优先使用 Agent 通道（SDK 已采集的定时器数据）
		if (ctx.agentClient) {
			const metrics = await ctx.agentClient.getMetrics(ctx.pid)
			if (metrics?.timers && Array.isArray(metrics.timers) && metrics.timers.length > 0) {
				return ok({ timers: metrics.timers }, DataSource.AGENT)
			}
		}

		// 回退到 Inspector 注入：检测 SDK 是否加载并读取内部数据
		const session = await ensureSession(ctx)
		const data = await session.evaluate(
			FUNCTION_WRAPPER(`
				if (globalThis.__MITO_NODE_ACTIVE__) {
					return { sdkActive: true, message: 'Timer data is available via Agent channel. Ensure Rust Agent is running.' };
				}
				return { sdkActive: false, message: 'Timer detection requires @mitojs/node SDK to be loaded in the target process.' };
			`)
		)

		if (data?.sdkActive === false) {
			return fail(data.message)
		}

		return ok(data, DataSource.INSPECTOR)
	},
}

import type { DiagnosticPlugin } from '../core/plugin.js'
import { DataSource, fail, ok, readAgentMetrics } from '../helper.js'
export const timersPlugin: DiagnosticPlugin = {
	name: 'timers',
	label: '查看活跃定时器',
	subject: 'Timeout',
	description: 'List current active timers and creation stacks (requires SDK)',
	async execute(ctx) {
		const metrics = await readAgentMetrics(ctx, 'Timeout')
		if (metrics && Array.isArray(metrics.timers)) return ok({ timers: metrics.timers }, DataSource.AGENT)
		return fail(
			'Fresh timer data requires @mitojs/node SDK with Timeout enabled.',
			'SDK_REQUIRED',
			'Enable SDK timer collection and verify the Agent connection.'
		)
	},
}

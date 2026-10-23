import type { DiagnosticPlugin } from '../core/plugin.js'
import { DataSource, fail, ok, readAgentMetrics } from '../helper.js'

export const errorsPlugin: DiagnosticPlugin = {
	name: 'errors',
	label: '查看最近错误',
	subject: 'JSError',
	description: 'Read recent captured errors and stack traces (requires SDK)',
	async execute(ctx) {
		const metrics = await readAgentMetrics(ctx, 'JSError')
		if (metrics && Array.isArray(metrics.errors)) return ok({ errors: metrics.errors }, DataSource.AGENT)
		return fail(
			'Recent errors require @mitojs/node SDK with JSError enabled.',
			'SDK_REQUIRED',
			'Enable SDK error collection and verify the Agent connection.'
		)
	},
}

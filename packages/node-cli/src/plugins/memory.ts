import { getMemoryInjectable } from '@mitojs/node-shared/recipes'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { DataSource, ensureSession, FUNCTION_WRAPPER, ok, readAgentMetrics } from '../helper.js'
export const memoryPlugin: DiagnosticPlugin = {
	name: 'memory',
	label: '查看内存详情',
	subject: 'Memory',
	description: 'Get V8 heap and process memory in bytes',
	async execute(ctx) {
		const metrics = await readAgentMetrics(ctx, 'Memory')
		if (metrics?.memory) return ok(metrics.memory, DataSource.AGENT)
		const session = await ensureSession(ctx)
		return ok(await session.evaluate(FUNCTION_WRAPPER(getMemoryInjectable())), DataSource.INSPECTOR)
	},
}

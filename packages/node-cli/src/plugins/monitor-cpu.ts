import { getCpuSnapshotInjectable } from '@mitojs/node-shared/recipes'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { DataSource, ensureSession, FUNCTION_WRAPPER, ok } from '../helper.js'

export const monitorCpuPlugin: DiagnosticPlugin = {
	name: 'monitor-cpu',
	description: 'Monitor CPU usage of the target process',
	async execute(ctx) {
		if (ctx.agentClient) {
			const metrics = await ctx.agentClient.getMetrics(ctx.pid)
			if (metrics?.cpu) {
				const cpu = metrics.cpu as { load?: number }
				return ok({ cpuPercent: cpu.load ?? 0 }, DataSource.AGENT)
			}
		}

		const session = await ensureSession(ctx)
		const data = await session.evaluate(FUNCTION_WRAPPER(getCpuSnapshotInjectable()))
		// CPU 百分比需要两次采样计算差值，单次快照返回当前累计使用率
		const totalCpuMicros = data.user + data.system
		const uptimeNs = BigInt(data.hrtime)
		const uptimeMicros = Number(uptimeNs) / 1e3
		const cpuPercent = uptimeMicros > 0 ? Math.min((totalCpuMicros / uptimeMicros) * 100, 100) : 0

		return ok({ cpuPercent }, DataSource.INSPECTOR)
	},
}

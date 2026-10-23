import { calculateCpuPercent, getCpuSnapshotInjectable } from '@mitojs/node-shared/recipes'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { DataSource, ensureSession, FUNCTION_WRAPPER, ok, readAgentMetrics, wait } from '../helper.js'

export const monitorCpuPlugin: DiagnosticPlugin = {
	name: 'monitor-cpu',
	label: '查看 CPU 使用率',
	subject: 'CPU',
	description: 'Read one CPU sample (process usage, may exceed 100% on multiple cores)',
	async execute(ctx) {
		const metrics = await readAgentMetrics(ctx, 'CPU')
		if (metrics?.cpu && Number.isFinite(metrics.cpu.load)) {
			// Keep producer time: retrieval time would duplicate samples and hide stale SDK data.
			return ok(
				{
					cpuPercent: metrics.cpu.load,
					sampledAt: ctx.processInfo?.updatedAt?.CPU,
					interval: ctx.processInfo?.intervals?.CPU,
				},
				DataSource.AGENT
			)
		}
		const session = await ensureSession(ctx)
		const expression = FUNCTION_WRAPPER(getCpuSnapshotInjectable())
		const first = await session.evaluate(expression)
		await wait(1000, ctx.signal)
		const second = await session.evaluate(expression)
		// hrtime is monotonic, not process uptime; only differences describe this sample window.
		const elapsedMicros = Number(BigInt(second.hrtime) - BigInt(first.hrtime)) / 1000
		const cpu = calculateCpuPercent(
			second.cpuUsage.user - first.cpuUsage.user,
			second.cpuUsage.system - first.cpuUsage.system,
			elapsedMicros
		)
		return ok({ cpuPercent: cpu.load, sampledAt: Date.now(), interval: 1000 }, DataSource.INSPECTOR)
	},
}

interface InspectorClientLike {
	evaluate<T = unknown>(expression: string, timeoutMs?: number): Promise<T>
	send<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

interface CpuProfileResponse {
	profile: unknown
}

const RUNTIME_EVALUATE_TIMEOUT_MS = 10000

function wait(durationMs: number) {
	if (durationMs <= 0) {
		return Promise.resolve()
	}

	return new Promise((resolve) => setTimeout(resolve, durationMs))
}

export function collectMemory(client: Pick<InspectorClientLike, 'evaluate'>) {
	return client.evaluate(
		`(() => {
			const v8 = require('v8')
			return {
				pid: process.pid,
				collectedAt: new Date().toISOString(),
				memoryUsage: process.memoryUsage(),
				resourceUsage: typeof process.resourceUsage === 'function' ? process.resourceUsage() : null,
				heapStatistics: typeof v8.getHeapStatistics === 'function' ? v8.getHeapStatistics() : null,
				heapSpaceStatistics: typeof v8.getHeapSpaceStatistics === 'function' ? v8.getHeapSpaceStatistics() : null
			}
		})()`,
		RUNTIME_EVALUATE_TIMEOUT_MS
	)
}

export function collectProcessReport(client: Pick<InspectorClientLike, 'evaluate'>) {
	return client.evaluate(
		`(() => {
			if (!process.report || typeof process.report.getReport !== 'function') {
				throw new Error('process.report.getReport is not available')
			}
			return process.report.getReport()
		})()`,
		RUNTIME_EVALUATE_TIMEOUT_MS
	)
}

export async function collectCpuProfile(client: Pick<InspectorClientLike, 'send'>, durationMs: number) {
	await client.send('Profiler.enable')
	await client.send('Profiler.start')

	try {
		await wait(durationMs)
		const result = await client.send<CpuProfileResponse>('Profiler.stop')
		return result.profile
	} finally {
		await client.send('Profiler.disable').catch(() => undefined)
	}
}

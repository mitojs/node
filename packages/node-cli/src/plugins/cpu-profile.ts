import { writeFileSync } from 'node:fs'
import type { DiagnosticPlugin } from '../core/plugin.js'
import type { DiagnosticResult } from '../core/types.js'
import { ensureSession, fail, genFilename, ok, wait } from '../helper.js'
import type { InspectorSession } from '../services/inspector-session.js'

export const cpuProfilePlugin: DiagnosticPlugin = {
	name: 'cpuprofile',
	label: '采集 CPU Profile',
	description: 'Capture a CPU profile from the target process',
	options: [{ flags: '-d, --duration <ms>', description: 'Profiling duration in milliseconds', defaultValue: '10000' }],
	async execute(ctx, options) {
		const duration = Number(options.duration ?? 10000)
		if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 3600000)
			return fail('--duration must be an integer between 1 and 3600000 ms', 'INVALID_ARGUMENT')
		let session: InspectorSession | undefined
		let enableAttempted = false
		let startAttempted = false
		let stopped = false
		let result: DiagnosticResult | undefined
		let cleanupError: Error | undefined
		try {
			if (ctx.signal?.aborted) throw ctx.signal.reason ?? new DOMException('Operation cancelled', 'AbortError')
			session = await ensureSession(ctx)
			// CDP 必须确认 enable 完成后才能开始；采集窗口从 start 响应后计时。
			enableAttempted = true
			await session.sendMessage('Profiler.enable')
			startAttempted = true
			await session.sendMessage('Profiler.start')
			await wait(duration, ctx.signal)
			const data = await session.sendMessage('Profiler.stop')
			stopped = true
			if (!data?.profile || typeof data.profile !== 'object') throw new Error('Profiler did not return a profile')
			const filename = genFilename('cpuprofile', options.dir)
			writeFileSync(filename, JSON.stringify(data.profile))
			result = ok({ filename }, 'inspector')
		} catch (error) {
			const value = error as Error & { code?: string }
			const reason = ctx.signal?.reason as (Error & { code?: string }) | undefined
			const cancelled = ctx.signal?.aborted || value.name === 'AbortError'
			const code =
				reason?.code === 'TIMEOUT' ? 'TIMEOUT' : cancelled ? 'CANCELLED' : (value.code ?? 'DIAGNOSTIC_FAILED')
			result = fail(value.message || String(error), code)
		} finally {
			// 取消只结束本地等待；已启动的目标端 Profiler 仍必须 stop/disable，清理请求绕过已取消的 signal。
			if (session && startAttempted && !stopped) {
				try {
					await session.sendMessage('Profiler.stop', undefined, { cleanup: true })
				} catch (error) {
					cleanupError = error as Error
				}
			}
			if (session && enableAttempted) {
				try {
					await session.sendMessage('Profiler.disable', undefined, { cleanup: true })
				} catch (error) {
					cleanupError ??= error as Error
				}
			}
		}
		if (cleanupError) {
			if (result?.success)
				return {
					...fail(`Profile captured but profiler cleanup failed: ${cleanupError.message}`, 'CLEANUP_FAILED'),
					data: result.data,
				}
			if (result) result.error = `${result.error}; profiler cleanup failed: ${cleanupError.message}`
		}
		return result ?? fail('CPU profiling failed')
	},
}

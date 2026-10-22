import { registry } from '../core/registry.js'
import type { DiagnosticContext, DiagnosticEvent, DiagnosticResult, OutputData } from '../core/types.js'
import { AgentClient } from './agent-client.js'
import { extractArtifactPaths, HistoryStore } from './history.js'
import type { InspectorSession } from './inspector-session.js'

export interface DiagnosticSettings {
	pid: number
	port?: number
	agentPort?: number
	timeout?: number
	signal?: AbortSignal
	onEvent?: (event: DiagnosticEvent) => void
	session?: InspectorSession
	historyDir?: string
	recordHistory?: boolean
}

function failure(command: string, errorCode: string, error: string, suggestion?: string): OutputData {
	return { success: false, command, errorCode, error, ...(suggestion ? { suggestion } : {}) }
}

/** Both terminal and machine interfaces use this boundary; only interface adapters may print. */
export async function executeDiagnostic(
	command: string,
	options: Record<string, any> = {},
	settings: DiagnosticSettings
): Promise<OutputData> {
	const plugin = registry.get(command)
	if (!plugin) return failure(command, 'INVALID_ARGUMENT', `Unknown diagnostic command: ${command}`)
	const port = settings.port ?? 9229
	const agentPort = settings.agentPort ?? (Number(process.env.MITO_AGENT_TCP_PORT) || 16666)
	const timeout = settings.timeout ?? 30000
	if (
		![port, agentPort].every((value) => Number.isInteger(value) && value > 0 && value <= 65535) ||
		!Number.isSafeInteger(timeout) ||
		timeout <= 0
	) {
		return failure(
			command,
			'INVALID_ARGUMENT',
			'Ports must be integers from 1 to 65535 and timeout must be a positive integer in milliseconds.'
		)
	}
	if (plugin.requiresTarget !== false) {
		if (!Number.isSafeInteger(settings.pid) || settings.pid <= 0)
			return failure(command, 'INVALID_ARGUMENT', '--pid must be a positive integer.')
		try {
			process.kill(settings.pid, 0)
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			return failure(
				command,
				code === 'EPERM' ? 'PERMISSION_DENIED' : 'PROCESS_NOT_FOUND',
				`Cannot access process ${settings.pid}: ${(error as Error).message}`
			)
		}
	}
	const startedAt = Date.now()
	const controller = new AbortController()
	const onAbort = () =>
		controller.abort(
			new DOMException('Operation cancelled; a target-side operation may still be finishing.', 'AbortError')
		)
	settings.signal?.addEventListener('abort', onAbort, { once: true })
	if (settings.signal?.aborted) onAbort()
	const timer = setTimeout(
		() => controller.abort(Object.assign(new Error(`Diagnostic timeout after ${timeout}ms`), { code: 'TIMEOUT' })),
		timeout
	)
	let rejectAbort: ((reason: unknown) => void) | undefined
	const abortPromise = new Promise<never>((_resolve, reject) => {
		rejectAbort = reject
	})
	const rejectOnAbort = () => rejectAbort?.(controller.signal.reason)
	controller.signal.addEventListener('abort', rejectOnAbort, { once: true })
	const ctx: DiagnosticContext = {
		pid: settings.pid,
		port,
		agentPort,
		timeout,
		json: true,
		session: settings.session,
		signal: controller.signal,
		output: () => {},
		onEvent: settings.onEvent,
	}
	let result: OutputData
	let operationPromise: Promise<DiagnosticResult> | undefined
	let cleanupWarning: string | undefined
	try {
		settings.onEvent?.({ type: 'started', command, elapsedMs: 0 })
		if (controller.signal.aborted) throw controller.signal.reason
		const operation = async () => {
			if (plugin.subject || command === 'diagnose') {
				const client = new AgentClient(agentPort, { signal: controller.signal, timeout })
				if (await client.isAvailable()) ctx.agentClient = client
			}
			return plugin.execute(ctx, { ...options, historyDir: settings.historyDir ?? options.historyDir })
		}
		operationPromise = operation()
		const diagnostic = await Promise.race([operationPromise, abortPromise])
		result = { ...diagnostic, command }
		if (!result.success) result.errorCode ??= 'DIAGNOSTIC_FAILED'
	} catch (error) {
		const value = error as Error & { code?: string; suggestion?: string }
		const code =
			value.code === 'TIMEOUT'
				? 'TIMEOUT'
				: value.name === 'AbortError'
					? 'CANCELLED'
					: typeof value.code === 'string'
						? value.code
						: value instanceof TypeError || value instanceof RangeError
							? 'INVALID_ARGUMENT'
							: 'DIAGNOSTIC_FAILED'
		result = failure(command, code, value.message ?? String(error), value.suggestion)
	} finally {
		clearTimeout(timer)
		settings.signal?.removeEventListener('abort', onAbort)
		controller.signal.removeEventListener('abort', rejectOnAbort)
		if (controller.signal.aborted && ctx.session && operationPromise) {
			// A cancelled Profiler needs its bounded stop/disable RPCs before the socket is released.
			let graceTimer: ReturnType<typeof setTimeout> | undefined
			await Promise.race([
				operationPromise.catch(() => {}),
				new Promise<void>((resolve) => {
					graceTimer = setTimeout(resolve, 2500)
				}),
			])
			if (graceTimer) clearTimeout(graceTimer)
		}
		if (ctx.session && ctx.session !== settings.session) {
			try {
				await ctx.session.dispose(command === 'start-inspect')
			} catch (error) {
				// A saved profile can be valid even if a third-party debugger prevents shutdown; expose that separately.
				cleanupWarning = (error as Error).message
			}
		}
	}
	result.meta = { ...result.meta, elapsedMs: Date.now() - startedAt }
	if (cleanupWarning)
		result = {
			...result,
			success: false,
			errorCode: 'CLEANUP_FAILED',
			error: `${result.error || 'Diagnostic completed'}; session cleanup failed: ${cleanupWarning}`,
		}
	if (command !== 'history' && settings.recordHistory !== false) {
		try {
			const record = await new HistoryStore({ directory: settings.historyDir ?? options.historyDir }).append({
				pid: settings.pid,
				command,
				success: result.success,
				result,
				dataSource: result.data?.source,
				artifacts: extractArtifactPaths(result),
			})
			result.meta = { ...result.meta, historyId: record.id }
		} catch (error) {
			result.meta = { ...result.meta, historyWarning: (error as Error).message }
		}
	}
	settings.onEvent?.({ type: 'completed', command, elapsedMs: result.meta?.elapsedMs })
	return result
}

import { join } from 'node:path'
import { openInspectorSession } from '../inspector/session.js'
import { createBundleWriter } from './bundle.js'
import { collectCpuProfile, collectMemory, collectProcessReport } from './collectors.js'
import type { AnalyzeResult } from './types.js'

interface AnalyzeOptions {
	pid: number
	port?: number
	outDir?: string
	duration?: number
}

interface AnalyzeClient {
	evaluate<T = unknown>(expression: string, timeoutMs?: number): Promise<T>
	send<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

interface AnalyzeSession {
	client: AnalyzeClient
	openedByCli: boolean
	close(): Promise<void> | void
}

interface AnalyzeCollectors {
	memory: (client: AnalyzeClient) => Promise<unknown>
	report: (client: AnalyzeClient) => Promise<unknown>
	cpuProfile: (client: AnalyzeClient, duration: number) => Promise<unknown>
}

interface AnalyzeDeps {
	openSession: (options: { pid: number; port: number }) => Promise<AnalyzeSession>
	collectors: AnalyzeCollectors
	now: () => Date
}

type PartialAnalyzeDeps = Partial<AnalyzeDeps> & {
	collectors?: Partial<AnalyzeCollectors>
}

const DEFAULT_PORT = 9229
const DEFAULT_DURATION = 10000

function defaultOutDir() {
	return join(process.cwd(), '.mito-node', 'bundles')
}

function assertPositiveInteger(value: number, name: string) {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`)
	}
}

function normalizeOptions(options: AnalyzeOptions) {
	const pid = Number(options.pid)
	const port = Number(options.port ?? DEFAULT_PORT)
	const duration = Number(options.duration ?? DEFAULT_DURATION)

	assertPositiveInteger(pid, 'pid')
	assertPositiveInteger(port, 'port')

	if (!Number.isFinite(duration) || duration < 0) {
		throw new Error('duration must be a non-negative number')
	}

	return {
		pid,
		port,
		duration,
		outDir: options.outDir || defaultOutDir(),
	}
}

function toErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function createDeps(deps?: PartialAnalyzeDeps): AnalyzeDeps {
	return {
		openSession: deps?.openSession || openInspectorSession,
		collectors: {
			memory: deps?.collectors?.memory || collectMemory,
			report: deps?.collectors?.report || collectProcessReport,
			cpuProfile: deps?.collectors?.cpuProfile || collectCpuProfile,
		},
		now: deps?.now || (() => new Date()),
	}
}

export async function runAnalyze(options: AnalyzeOptions, deps?: PartialAnalyzeDeps): Promise<AnalyzeResult> {
	const normalizedOptions = normalizeOptions(options)
	const runtimeDeps = createDeps(deps)
	const writer = createBundleWriter({
		outDir: normalizedOptions.outDir,
		pid: normalizedOptions.pid,
		startedAt: runtimeDeps.now(),
	})
	const warnings: string[] = []
	const errors: string[] = []
	let session: AnalyzeSession | undefined

	try {
		session = await runtimeDeps.openSession({ pid: normalizedOptions.pid, port: normalizedOptions.port })
		if (session.openedByCli) {
			warnings.push('inspector was opened by mito-node for this analysis and closed after collection')
		}
	} catch (error) {
		errors.push(toErrorMessage(error))
		return writer.finalize({
			command: 'unknown',
			duration: normalizedOptions.duration,
			warnings,
			errors,
		})
	}

	try {
		try {
			const memory = await runtimeDeps.collectors.memory(session.client)
			writer.writeJsonArtifact('memory', 'memory.json', memory)
		} catch (error) {
			const message = toErrorMessage(error)
			errors.push(message)
			writer.markFailed('memory', 'memory.json', message)
		}

		try {
			const report = await runtimeDeps.collectors.report(session.client)
			writer.writeJsonArtifact('report', 'process.report.json', report)
		} catch (error) {
			const message = toErrorMessage(error)
			errors.push(message)
			writer.markFailed('report', 'process.report.json', message)
		}

		try {
			const cpuProfile = await runtimeDeps.collectors.cpuProfile(session.client, normalizedOptions.duration)
			writer.writeJsonArtifact('cpuProfile', 'cpu.cpuprofile', cpuProfile)
		} catch (error) {
			const message = toErrorMessage(error)
			errors.push(message)
			writer.markFailed('cpuProfile', 'cpu.cpuprofile', message)
		}
	} finally {
		try {
			await session.close()
		} catch (error) {
			warnings.push(`failed to clean up inspector session: ${toErrorMessage(error)}`)
		}
	}

	return writer.finalize({
		command: 'unknown',
		duration: normalizedOptions.duration,
		warnings,
		errors,
	})
}

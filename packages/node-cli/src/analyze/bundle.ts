import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
	AnalyzeArtifactKey,
	AnalyzeArtifacts,
	AnalyzeReadKey,
	AnalyzeResult,
	AnalyzeStatus,
	ArtifactStatus,
} from './types.js'

const CORE_ARTIFACT_KEYS: AnalyzeArtifactKey[] = ['memory', 'report', 'cpuProfile']

const READ_ORDER: AnalyzeReadKey[] = ['summaryMd', 'summaryJson', 'memory', 'report', 'cpuProfile']

const ARTIFACT_FILE_NAMES: Record<AnalyzeArtifactKey, string> = {
	manifest: 'manifest.json',
	summaryJson: 'summary.json',
	summaryMd: 'summary.md',
	memory: 'memory.json',
	report: 'process.report.json',
	cpuProfile: 'cpu.cpuprofile',
}

interface CreateBundleWriterOptions {
	outDir: string
	pid: number
	startedAt: Date
}

interface FinalizeOptions {
	command?: string
	duration: number
	warnings: string[]
	errors: string[]
}

function formatBundleTimestamp(date: Date) {
	return date.toISOString().replace(/[:.]/g, '-')
}

function createInitialArtifacts(bundleDir: string): AnalyzeArtifacts {
	return {
		manifest: { path: join(bundleDir, ARTIFACT_FILE_NAMES.manifest), status: 'skipped' },
		summaryJson: { path: join(bundleDir, ARTIFACT_FILE_NAMES.summaryJson), status: 'skipped' },
		summaryMd: { path: join(bundleDir, ARTIFACT_FILE_NAMES.summaryMd), status: 'skipped' },
		memory: { path: join(bundleDir, ARTIFACT_FILE_NAMES.memory), status: 'skipped' },
		report: { path: join(bundleDir, ARTIFACT_FILE_NAMES.report), status: 'skipped' },
		cpuProfile: { path: join(bundleDir, ARTIFACT_FILE_NAMES.cpuProfile), status: 'skipped' },
	}
}

function cloneArtifacts(artifacts: AnalyzeArtifacts): AnalyzeArtifacts {
	return {
		manifest: { ...artifacts.manifest },
		summaryJson: { ...artifacts.summaryJson },
		summaryMd: { ...artifacts.summaryMd },
		memory: { ...artifacts.memory },
		report: { ...artifacts.report },
		cpuProfile: { ...artifacts.cpuProfile },
	}
}

function getAnalyzeStatus(artifacts: AnalyzeArtifacts): AnalyzeStatus {
	const coreArtifacts = CORE_ARTIFACT_KEYS.map((key) => artifacts[key])
	const okCount = coreArtifacts.filter((artifact) => artifact.status === 'ok').length
	const failedCount = coreArtifacts.filter((artifact) => artifact.status === 'failed').length

	if (okCount === 0) {
		return 'failed'
	}

	return failedCount > 0 ? 'partial' : 'success'
}

function getReadOrder(artifacts: AnalyzeArtifacts): AnalyzeReadKey[] {
	return READ_ORDER.filter((key) => artifacts[key].status === 'ok')
}

function writeJson(path: string, data: unknown) {
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

function formatSummaryMarkdown(result: AnalyzeResult, options: FinalizeOptions) {
	const artifactRows = Object.entries(result.artifacts)
		.map(([key, artifact]) => `- ${key}: ${artifact.status}${artifact.error ? ` (${artifact.error})` : ''}`)
		.join('\n')
	const warnings = result.warnings.length > 0 ? result.warnings.map((warning) => `- ${warning}`).join('\n') : '- none'
	const errors = result.errors.length > 0 ? result.errors.map((error) => `- ${error}`).join('\n') : '- none'

	return `# mito-node analysis summary

## Target
- PID: ${result.pid}
- Command: ${options.command || 'unknown'}
- Duration: ${options.duration} ms

## Artifacts
${artifactRows}

## Suggested read order
${result.readOrder.map((key, index) => `${index + 1}. ${key}`).join('\n')}

## Warnings
${warnings}

## Errors
${errors}
`
}

export function createBundleWriter(options: CreateBundleWriterOptions) {
	const bundleDir = join(options.outDir, `${options.pid}-${formatBundleTimestamp(options.startedAt)}`)
	const artifacts = createInitialArtifacts(bundleDir)

	mkdirSync(bundleDir, { recursive: true })

	function setArtifact(key: AnalyzeArtifactKey, status: ArtifactStatus) {
		artifacts[key] = status
	}

	return {
		bundleDir,
		writeJsonArtifact(key: AnalyzeArtifactKey, fileName: string, data: unknown) {
			const path = join(bundleDir, fileName)
			writeJson(path, data)
			setArtifact(key, { path, status: 'ok' })
		},
		writeTextArtifact(key: AnalyzeArtifactKey, fileName: string, data: string) {
			const path = join(bundleDir, fileName)
			writeFileSync(path, data)
			setArtifact(key, { path, status: 'ok' })
		},
		markFailed(key: AnalyzeArtifactKey, fileName: string, error: Error | string) {
			setArtifact(key, {
				path: join(bundleDir, fileName),
				status: 'failed',
				error: typeof error === 'string' ? error : error.message,
			})
		},
		markSkipped(key: AnalyzeArtifactKey, fileName: string) {
			setArtifact(key, { path: join(bundleDir, fileName), status: 'skipped' })
		},
		finalize(finalizeOptions: FinalizeOptions): AnalyzeResult {
			const status = getAnalyzeStatus(artifacts)
			const result: AnalyzeResult = {
				status,
				pid: options.pid,
				bundleDir,
				artifacts: cloneArtifacts(artifacts),
				readOrder: getReadOrder(artifacts),
				warnings: finalizeOptions.warnings,
				errors: finalizeOptions.errors,
			}

			result.artifacts.summaryJson = { path: artifacts.summaryJson.path, status: 'ok' }
			result.artifacts.summaryMd = { path: artifacts.summaryMd.path, status: 'ok' }
			result.artifacts.manifest = { path: artifacts.manifest.path, status: 'ok' }
			result.readOrder = getReadOrder(result.artifacts)

			writeJson(result.artifacts.summaryJson.path, result)
			writeFileSync(result.artifacts.summaryMd.path, formatSummaryMarkdown(result, finalizeOptions))
			writeJson(result.artifacts.manifest.path, {
				pid: result.pid,
				status: result.status,
				bundleDir,
				artifacts: result.artifacts,
				createdAt: options.startedAt.toISOString(),
			})

			return result
		},
	}
}

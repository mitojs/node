export type AnalyzeStatus = 'success' | 'partial' | 'failed'

export type ArtifactWriteStatus = 'ok' | 'skipped' | 'failed'

export type AnalyzeArtifactKey = 'manifest' | 'summaryJson' | 'summaryMd' | 'memory' | 'report' | 'cpuProfile'

export interface ArtifactStatus {
	path: string
	status: ArtifactWriteStatus
	error?: string
}

export interface AnalyzeArtifacts {
	manifest: ArtifactStatus
	summaryJson: ArtifactStatus
	summaryMd: ArtifactStatus
	memory: ArtifactStatus
	report: ArtifactStatus
	cpuProfile: ArtifactStatus
}

export type AnalyzeReadKey = 'summaryMd' | 'summaryJson' | 'memory' | 'report' | 'cpuProfile'

export interface AnalyzeResult {
	status: AnalyzeStatus
	pid: number
	bundleDir: string
	artifacts: AnalyzeArtifacts
	readOrder: AnalyzeReadKey[]
	warnings: string[]
	errors: string[]
}

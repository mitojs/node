import type { DiagnosticContext, DiagnosticResult, PluginOption } from './types.js'

export interface DiagnosticPlugin {
	name: string
	description: string
	options?: PluginOption[]
	execute(context: DiagnosticContext, options: Record<string, any>): Promise<DiagnosticResult>
}

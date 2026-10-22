import type { DiagnosticContext, DiagnosticResult, PluginOption } from './types.js'

export interface DiagnosticPlugin {
	name: string
	description: string
	label?: string
	subject?: 'CPU' | 'Memory' | 'JSError' | 'Timeout'
	requiresTarget?: boolean
	options?: PluginOption[]
	execute(context: DiagnosticContext, options: Record<string, any>): Promise<DiagnosticResult>
}

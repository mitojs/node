import type { AgentClient, ProcessInfo } from '../services/agent-client.js'
import type { InspectorSession } from '../services/inspector-session.js'

export interface PluginOption {
	flags: string
	description: string
	defaultValue?: string
}

export interface DiagnosticEvent {
	type: 'started' | 'progress' | 'completed'
	command: string
	message?: string
	elapsedMs?: number
}

export interface DiagnosticContext {
	pid: number
	port: number
	json: boolean
	session?: InspectorSession
	agentClient?: AgentClient
	processInfo?: ProcessInfo | null
	agentPort?: number
	timeout?: number
	signal?: AbortSignal
	onEvent?: (event: DiagnosticEvent) => void
	output: (data: OutputData) => void
}

export interface DiagnosticResult<T = any> {
	success: boolean
	data?: T
	error?: string
	errorCode?: string
	suggestion?: string
}

export interface OutputData<T = any> extends DiagnosticResult<T> {
	command: string
	meta?: { elapsedMs?: number; historyId?: string; historyWarning?: string }
}

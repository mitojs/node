import type { AgentClient } from '../services/agent-client.js'
import type { InspectorSession } from '../services/inspector-session.js'

export interface PluginOption {
	flags: string
	description: string
	defaultValue?: string
}

export interface DiagnosticContext {
	pid: number
	port: number
	json: boolean
	session?: InspectorSession
	agentClient?: AgentClient
	output: (data: OutputData) => void
}

export interface DiagnosticResult {
	success: boolean
	data?: any
	error?: string
}

export interface OutputData {
	success: boolean
	command: string
	data?: any
	error?: string
	errorCode?: string
	suggestion?: string
}

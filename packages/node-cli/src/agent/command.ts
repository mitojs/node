import {
	type AgentClientOptions,
	type AgentMetricsOptions,
	DEFAULT_AGENT_HOST,
	DEFAULT_AGENT_PORT,
	DEFAULT_AGENT_TIMEOUT,
} from './types.js'

interface AgentCommandOptions {
	host?: string
	port?: string
	timeout?: string
}

interface AgentMetricsCommandOptions extends AgentCommandOptions {
	pid: string
}

function toNumber(value: string | undefined, fallback: number) {
	return value === undefined ? fallback : Number(value)
}

export function toAgentOptions(options: AgentCommandOptions): AgentClientOptions {
	return {
		host: options.host ?? DEFAULT_AGENT_HOST,
		port: toNumber(options.port, DEFAULT_AGENT_PORT),
		timeout: toNumber(options.timeout, DEFAULT_AGENT_TIMEOUT),
	}
}

export function toAgentMetricsOptions(options: AgentMetricsCommandOptions): AgentMetricsOptions {
	return {
		...toAgentOptions(options),
		pid: Number(options.pid),
	}
}

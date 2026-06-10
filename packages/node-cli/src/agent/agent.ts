import { getAgentInfo, listAgentProcesses } from './client.js'
import type { AgentClientOptions, AgentInfo, AgentMetricsOptions, AgentProcessSnapshot } from './types.js'

interface AgentDeps {
	getAgentInfo: (options: AgentClientOptions) => Promise<AgentInfo>
	listAgentProcesses: (options: AgentClientOptions) => Promise<AgentProcessSnapshot[]>
}

const defaultDeps: AgentDeps = {
	getAgentInfo,
	listAgentProcesses,
}

export async function runAgentStatus(options: AgentClientOptions, deps: AgentDeps = defaultDeps) {
	const [agent, processes] = await Promise.all([deps.getAgentInfo(options), deps.listAgentProcesses(options)])

	return {
		agent,
		processes,
	}
}

export async function runAgentProcesses(options: AgentClientOptions, deps: AgentDeps = defaultDeps) {
	return deps.listAgentProcesses(options)
}

export async function runAgentMetrics(options: AgentMetricsOptions, deps: AgentDeps = defaultDeps) {
	const processes = await deps.listAgentProcesses(options)
	const processInfo = processes.find((process) => process.process_id === options.pid)

	if (!processInfo || processInfo.latest_metrics.length === 0) {
		return {
			status: 'not_found' as const,
			pid: options.pid,
			metrics: [],
		}
	}

	return {
		status: 'success' as const,
		pid: options.pid,
		metrics: processInfo.latest_metrics,
	}
}

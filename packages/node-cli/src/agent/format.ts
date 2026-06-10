import type { AgentMetricsResult, AgentProcessSnapshot, AgentStatusResult } from './types.js'

export function formatAgentStatus(result: AgentStatusResult) {
	return [
		`${result.agent.name} ${result.agent.version} ${result.agent.status}`,
		`Processes: ${result.processes.length}`,
	].join('\n')
}

export function formatAgentProcesses(processes: AgentProcessSnapshot[]) {
	if (processes.length === 0) {
		return 'No processes registered in mitojs-agent'
	}

	const lines = ['PID     PROXY   HEARTBEAT     METRICS']
	for (const processInfo of processes) {
		lines.push(
			[
				String(processInfo.process_id).padEnd(7),
				String(processInfo.proxy_port ?? '-').padEnd(7),
				String(processInfo.latest_heartbeat_time).padEnd(13),
				String(processInfo.latest_metrics.length),
			].join(' ')
		)
	}

	return lines.join('\n')
}

export function formatAgentMetrics(result: AgentMetricsResult) {
	if (result.status === 'not_found') {
		return `No metrics found for process ${result.pid}`
	}

	return result.metrics
		.map((metric) => {
			return `${metric.metric_type} @ ${metric.recorded_at}: ${JSON.stringify(metric.data)}`
		})
		.join('\n')
}

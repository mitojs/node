export const DEFAULT_AGENT_HOST = 'localhost'
export const DEFAULT_AGENT_PORT = 16666
export const DEFAULT_AGENT_TIMEOUT = 1000

export interface AgentClientOptions {
	host: string
	port: number
	timeout: number
}

export interface AgentMetricsOptions extends AgentClientOptions {
	pid: number
}

export interface AgentInfo {
	name: string
	version: string
	status: string
}

export interface AgentMetricSnapshot {
	metric_type: string
	data: unknown
	recorded_at: number
}

export interface AgentProcessSnapshot {
	process_id: number
	proxy_port: number | null
	latest_heartbeat_time: number
	latest_metrics: AgentMetricSnapshot[]
}

export interface AgentStatusResult {
	agent: AgentInfo
	processes: AgentProcessSnapshot[]
}

export interface AgentMetricsResult {
	status: 'success' | 'not_found'
	pid: number
	metrics: AgentMetricSnapshot[]
}

import type { IpcMessageCode, ListenerResultType, SubjectNames } from './shared'

export interface ConfigType {
	agentTCPPort: number
	agentHost: string
	pid: number
	dir: string
}

export interface RegisterProcessData {
	process_id: number
	proxy_port: number
}

export interface RecordMetricData {
	process_id: number
	metric_type: 'cpu' | 'memory' | 'js_error' | 'timeout'
	data: unknown
}

export interface AgentBaseResponse {
	success: boolean
	message: string
}

export interface IpcMessage {
	code: IpcMessageCode
	message: ListenerResultType | string
}

export interface MitoNodeOption {
	metrics?: {
		[SubjectNames.CPU]?: boolean
		[SubjectNames.Memory]?: boolean
		[SubjectNames.JSError]?: boolean
		[SubjectNames.Timeout]?: boolean
	}
}

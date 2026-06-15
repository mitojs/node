import type { IpcMessageCode, ListenerResultType, SubjectNames } from './shared'

export interface ConfigType {
	agentTCPPort: number
	agentHost: string
	pid: number
	dir: string
}

export interface RegisterProcessData {
	pid: number
	udsPath: string
}

export interface IpcMessage {
	code: IpcMessageCode
	message: ListenerResultType | string
}

export type MetricConfig = boolean | { interval?: number }

export interface MitoNodeOption {
	metrics?: {
		[SubjectNames.CPU]?: MetricConfig
		[SubjectNames.Memory]?: MetricConfig
		[SubjectNames.JSError]?: boolean
		[SubjectNames.Timeout]?: boolean
	}
}

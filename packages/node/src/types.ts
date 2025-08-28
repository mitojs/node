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

export interface MitoNodeOption {
	metrics?: {
		[SubjectNames.CPU]?: boolean
		[SubjectNames.Memory]?: boolean
		[SubjectNames.JSError]?: boolean
	}
}

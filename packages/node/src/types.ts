export interface ConfigType {
	agentTCPPort: number
	agentHost: string
	pid: number
}

export interface RegisterProcessData {
	pid: number
	udsPath: string
}

export enum IpcMessageCode {
	Ok = 200,
	Error = 500,
}

enum ListenerResultType {
	Success = 'success',
	AddrInUse = 'addr_in_use',
}

export interface IpcMessage {
	code: IpcMessageCode
	message: ListenerResultType | string
}

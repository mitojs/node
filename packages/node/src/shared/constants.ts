export const MITO_NODE = '_MITO_NODE_'
export const DEFAULT_TCP_PORT = 16666

export enum SubjectNames {
	CPU = 'CPU',
	JSError = 'JSError',
	Memory = 'Memory',
	FD = 'FD',
}

export enum IpcMessageCode {
	Ok = 200,
	Error = 500,
}

export enum ListenerResultType {
	Success = 'success',
	AddrInUse = 'addr_in_use',
}

export interface ConfigType {
	agentTCPPort: number
	agentHost: string
	pid: number
}

export interface RegisterProcessData {
	pid: number
	udsPath: string
}

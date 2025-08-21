export interface ConfigType {
	agentTCPPort: number
	agentHost: string
}

export interface RegisterProcessData {
	pid: number
	udsPath: string
}

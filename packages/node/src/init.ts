import { configMap } from './config'
import { DEFAULT_TCP_PORT } from './shared'

export function initConfig() {
	configMap.set({
		agentTCPPort: Number(process.env.MITO_AGENT_TCP_PORT) || DEFAULT_TCP_PORT,
		agentHost: 'localhost',
		pid: process.pid,
	})
}

export async function initUDSServer() {
	// 初始化 uds 服务端
	// getUds().listen()
}

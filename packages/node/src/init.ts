import { configMap } from './config'
import { DEFAULT_TCP_PORT } from './shared'

export function initConfig() {
	// 也可以通过环境变量配置
	configMap.set({
		agentTCPPort: Number(process.env.MITO_AGENT_TCP_PORT) || DEFAULT_TCP_PORT,
		agentHost: 'localhost',
	})
}

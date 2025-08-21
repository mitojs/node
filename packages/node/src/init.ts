import { DEFAULT_TCP_PORT } from './shared'
import { configMap } from './shared/config'

export function initConfig() {
	configMap.set({
		agentTCPPort: DEFAULT_TCP_PORT,
		agentHost: 'localhost',
	})
}

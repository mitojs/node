import { initAgent } from './binary'
import { initConfig } from './init'
import { MITO_NODE } from './shared'

export async function init() {
	if (global[MITO_NODE]) {
		return
	}
	global[MITO_NODE] = true

	try {
		initConfig()
		// 初始化agent
		const agent = initAgent()
		// 带着 port 参数启动 agent， AGENT_TCP_PORT=config.agentTCPPort
		await agent.start()
		// todo 与 agent 通信
	} catch (error) {}
}

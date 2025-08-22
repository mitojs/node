import { initAgent } from './binary'
import { configMap } from './config'
import { initConfig } from './init'
import { logger, MITO_NODE } from './shared'

export async function init() {
	if (global[MITO_NODE]) {
		return
	}
	global[MITO_NODE] = true

	try {
		initConfig()
		// 初始化agent
		const agent = initAgent()
		// 通过环境变量传递 TCP 端口启动 agent
		await agent.start()
		logger.info('mitojs-node init success')
		// todo 与 agent 通信
	} catch (error) {
		logger.error('mitojs-node init error', error)
	}
}

init()

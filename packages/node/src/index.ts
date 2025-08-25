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
		logger.info('mitojs-node init config successfully')
		// 初始化agent
		await initAgent()
		logger.info('mitojs-node rust agent started successfully')

		//
	} catch (error) {
		logger.error('mitojs-node init error', error)
	}
}

init()

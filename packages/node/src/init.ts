import path, { resolve } from 'node:path'
import { SHARE_ENV, Worker } from 'node:worker_threads'
import deepMerge from 'deepmerge'
import { configMap } from './config'
import {
	DEFAULT_TCP_PORT,
	IpcMessageCode,
	isMainThread,
	isSupportInspectWorker,
	isSupportWorker,
	logger,
	MITO_NODE,
	SubjectNames,
} from './shared'
import type { IpcMessage, MitoNodeOption } from './types'

export function preCheck() {
	if (global[MITO_NODE]) {
		throw new Error('has been initialized')
	}
	if (!isMainThread) {
		throw new Error('mitojs-node only support in main thread')
	}
	global[MITO_NODE] = true
}

export function initConfig() {
	configMap.update({
		agentTCPPort: Number(process.env.MITO_AGENT_TCP_PORT) || DEFAULT_TCP_PORT,
		agentHost: 'localhost',
		pid: process.pid,
	})
}

export const DEFAULT_MITO_NODE_OPTION: MitoNodeOption = {
	metrics: {
		[SubjectNames.CPU]: true,
		[SubjectNames.Memory]: true,
		[SubjectNames.JSError]: true,
	},
}

export function initOption(option?: MitoNodeOption) {
	return deepMerge(DEFAULT_MITO_NODE_OPTION, option || {})
}

export async function initProxyThread() {
	return new Promise((resolve, reject) => {
		if (!isSupportWorker || !isSupportInspectWorker) {
			logger.info(
				'It would not enable proxy thread because current Node.js version do not support connectToMainThread API'
			)
			return
		}

		const filepath = path.resolve(__dirname, './proxy_thread/index.js')
		const worker = new Worker(filepath, {
			workerData: {
				// here should use JSON.stringify to keep the data type,
				// otherwise, number will be transformed to string in worker
				MITO_NODE_CONFIG: JSON.stringify(configMap.get()),
			},
			// worker share the env with main thread
			env: SHARE_ENV,
		})
		worker.unref()
		const terminate = () => {
			worker?.terminate()
		}
		const onError = (err: Error) => {
			terminate()
			reject(new Error(`proxy thread error: ${err.message}`))
		}
		const onExit = (code: number) => {
			terminate()
			reject(new Error(`proxy thread exits with code: ${code}`))
		}
		worker.on('error', onError)
		worker.on('exit', onExit)
		worker.on('message', (message: IpcMessage) => {
			worker.off('error', onError)
			worker.off('exit', onExit)
			if (message.code === IpcMessageCode.Ok) {
				worker.on('error', (err) => {
					logger.info(`worker error: ${err.message}`)
				})
				worker.on('exit', (exitCode) => {
					logger.info(`worker exit with code: ${exitCode}`)
				})
				resolve(worker)
			} else {
				onError(new Error(message.message))
			}
		})
	})
}

/**
 * 同步当前进程信息到 agent，并拉取配置 agent 监听的 uds，用来传输 Metrics 数据
 */
export async function SyncToAgent() {
	// 同步当前进程信息到 agent
	// await registerProcessToAgent()
	// await getUDSPathFromAgent()
}

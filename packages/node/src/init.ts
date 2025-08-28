import fs from 'node:fs'
import http from 'node:http'
import deepMerge from 'deepmerge'
import { configMap } from './config'
import { getUDSPathFromAgent, registerProcessToAgent } from './request'
import {
	callWithinTryCatch,
	DEFAULT_TCP_PORT,
	getRandomString,
	getSockPath,
	logger,
	retry,
	SubjectNames,
} from './shared'
import type { MitoNodeOption } from './types'

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

/**
 * 用来接收 Rust Agent 下发的指令
 * @returns
 */
export async function initHttpServer(): Promise<http.Server> {
	let currentPort = DEFAULT_TCP_PORT + 1
	return retry<http.Server>(
		() => {
			return new Promise((resolve, reject) => {
				const errorHandler = (err: Error) => {
					logger.error('init http server error', err)
					currentPort++ // 每次重试时端口自增 1
					reject(err)
				}
				const server = http.createServer()
				server.listen(
					{
						port: currentPort,
						// 独占监听
						exclusive: true,
					},
					() => {
						server.off('error', errorHandler)
						server.on('close', () => {
							logger.info('http server closed')
						})
						// todo 处理 agent 下发的请求
						server.on('request', (req, res) => {
							logger.info('request', req, res)
						})
						server.on('upgrade', (req, socket, head) => {
							logger.info('upgrade', req, socket, head)
						})
						resolve(server)
					}
				)
				server.on('error', errorHandler)
			})
		},
		{ retry: 5, delayTime: 1000 }
	)
}

/**
 * 同步当前进程信息到 agent，并拉取配置 agent 监听的 uds，用来传输 Metrics 数据
 */
export async function SyncToAgent() {
	// 同步当前进程信息到 agent
	// await registerProcessToAgent()
	// await getUDSPathFromAgent()
}

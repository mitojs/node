import http from 'node:http'
import { logger } from './logger'
import { retry } from './utils'

/**
 * 用来接收 Rust Agent 下发的指令
 * @returns
 */
export async function createHttpServer(port: number): Promise<http.Server> {
	let currentPort = port
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
						// server.on('request', (req, res) => {
						// 	logger.info('request', req, res)
						// })
						// server.on('upgrade', (req, socket, head) => {
						// 	logger.info('upgrade', req, socket, head)
						// })
						resolve(server)
					}
				)
				server.on('error', errorHandler)
			})
		},
		{ retry: 5, delayTime: 1000 }
	)
}

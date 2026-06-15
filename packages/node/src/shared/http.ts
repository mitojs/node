import http from 'node:http'
import { logger } from './logger'
import { retry } from './utils'

/**
 * HTTP 服务器配置选项
 */
export interface HttpServerOptions {
	/** 初始端口号 */
	port: number
	/** 重试次数，默认为 5 */
	retryCount?: number
	/** 重试延迟时间（毫秒），默认为 1000 */
	retryDelay?: number
	/** 是否启用独占监听模式，默认为 true */
	exclusive?: boolean
	/** 主机地址，默认为 '0.0.0.0' */
	host?: string
	/** 请求处理函数 */
	onRequest?: (req: http.IncomingMessage, res: http.ServerResponse) => void
}

/**
 * 创建用于接收 Rust Agent 下发指令的 HTTP 服务器
 * @param options 服务器配置选项
 * @returns HTTP 服务器实例
 */
export async function createHttpServer(options: number | HttpServerOptions): Promise<http.Server> {
	// 处理兼容性：如果参数是数字，则将其转换为对象
	const config: HttpServerOptions = typeof options === 'number' ? { port: options } : options

	const { port, retryCount = 5, retryDelay = 1000, exclusive = true, host = '0.0.0.0', onRequest } = config

	let currentPort = port

	return retry<http.Server>(
		() => {
			return new Promise<http.Server>((resolve, reject) => {
				const server = http.createServer()

				// 优化错误处理逻辑
				const errorHandler = (err: Error) => {
					const errorMessage = `初始化 HTTP 服务器失败 (端口: ${currentPort}): ${err.message}`
					logger.error(errorMessage, err)
					currentPort++ // 每次重试时端口自增 1
					reject(err)
				}

				// 先注册错误事件处理器
				server.on('error', errorHandler)

				// 设置服务器配置
				server.listen(
					{
						port: currentPort,
						host,
						exclusive,
					},
					() => {
						// 服务器启动成功后，移除错误处理器
						server.off('error', errorHandler)
						logger.info(`HTTP 服务器成功启动在 ${host}:${currentPort}`)

						// 注册关闭事件处理器
						server.on('close', () => {
							logger.info(`HTTP 服务器已关闭 (${host}:${currentPort})`)
						})

						// 注册请求处理
						if (onRequest) {
							server.on('request', onRequest)
						}

						resolve(server)
					}
				)
			})
		},
		{ retry: retryCount, delayTime: retryDelay }
	)
}

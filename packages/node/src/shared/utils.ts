import * as http from 'node:http'
import * as https from 'node:https'
import os from 'node:os'
import { clearTimeout as cancelTimeout, setTimeout as scheduleTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import { URL } from 'node:url'
import { configMap } from '../config'
import { logger } from './logger'

interface RetryOptions {
	retry?: number
	delayTime?: number
}

export async function retry<T>(fn: Function, options: RetryOptions = {}): Promise<T> {
	if (typeof fn !== 'function') {
		throw new Error('fn is a function')
	}
	// @ts-ignore
	const retry = Math.max(0, options.retry ?? 1)
	// @ts-ignore
	const delayTime = Math.max(0, options.delayTime ?? 500)
	let time = 0
	while (true) {
		try {
			const result = (await fn()) as T
			return result
		} catch (e) {
			if (++time <= retry) {
				await delay(delayTime)
			} else {
				throw e
			}
		}
	}
}

export interface FetchOptions {
	method?: 'GET' | 'POST'
	headers?: Record<string, string>
	body?: string | Buffer
	timeout?: number
	signal?: AbortSignal
}

export interface FetchResponse {
	status: number
	statusText: string
	headers: Record<string, string>
	text(): Promise<string>
	json(): Promise<any>
}

export function easyFetch(url: string, options: FetchOptions = {}): Promise<FetchResponse> {
	return new Promise((resolve, reject) => {
		const { method = 'GET', headers = {}, body, timeout = 1000, signal } = options

		const parsedUrl = new URL(url)
		const isHttps = parsedUrl.protocol === 'https:'
		const httpModule = isHttps ? https : http

		const requestOptions = {
			hostname: parsedUrl.hostname,
			port: parsedUrl.port || (isHttps ? 443 : 80),
			path: parsedUrl.pathname + parsedUrl.search,
			method,
			headers,
			timeout,
			signal,
		}

		// 如果是 POST 请求且有 body，设置 Content-Length
		if (method === 'POST' && body) {
			const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8')
			requestOptions.headers['Content-Length'] = bodyBuffer.length.toString()
			if (!requestOptions.headers['Content-Type']) {
				requestOptions.headers['Content-Type'] = 'application/json'
			}
		}

		const req = httpModule.request(requestOptions, (res) => {
			let data = ''
			res.setEncoding('utf8')

			res.on('data', (chunk) => {
				data += chunk
			})

			res.on('error', reject)
			res.on('end', () => {
				cancelTimeout(deadline)
				const response: FetchResponse = {
					status: res.statusCode || 0,
					statusText: res.statusMessage || '',
					headers: res.headers as Record<string, string>,
					text: async () => data,
					json: async () => {
						try {
							return JSON.parse(data)
						} catch (e) {
							throw new Error('Invalid JSON response')
						}
					},
				}
				resolve(response)
			})
		})

		// socket timeout 只限制空闲时间；持续响应也必须受总耗时上限约束。
		const deadline = scheduleTimeout(() => req.destroy(new Error('Request timeout')), timeout)
		deadline.unref?.()
		req.on('error', (err) => {
			cancelTimeout(deadline)
			reject(new Error(`Request failed: ${err.message}`))
		})

		req.on('timeout', () => {
			req.destroy()
			reject(new Error('Request timeout'))
		})

		// 如果是 POST 请求且有 body，写入请求体
		if (method === 'POST' && body) {
			req.write(body)
		}

		req.end()
	})
}

// See https://nodejs.org/docs/latest/api/net.html#ipc-support
const MAX_SOCK_PATH_LEN = os.platform() === 'linux' ? 107 : 103 // linux and mac
export function getSockPath(baseSockName: string) {
	let sockPath = `${configMap.get('dir')}/${baseSockName}`
	logger.info(`original socket path: ${sockPath}`)
	if (sockPath.length > MAX_SOCK_PATH_LEN) {
		sockPath = `${process.cwd()}/${baseSockName}`
		if (sockPath.length > MAX_SOCK_PATH_LEN) {
			sockPath = `${os.tmpdir()}/${baseSockName}`
		}
	}
	logger.info(`unix domain sock path: ${sockPath}`)
	return sockPath
}

export function getRandomString(len: number) {
	const str = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz'
	const strlen = str.length
	let result = ''
	for (let i = 0; i < len; i++) {
		const index = ~~(Math.random() * strlen)
		result += `${str[index]}`
	}
	return result
}

export function callWithinTryCatch<T = any>(fn: Function, ...args: any[]) {
	try {
		return fn(...args) as T
	} catch (e) {
		logger.error('callWithinTryCatch error', e)
	}
}

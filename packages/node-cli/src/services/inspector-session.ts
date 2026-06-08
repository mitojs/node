import { EventEmitter } from 'node:events'
import * as http from 'node:http'
import * as net from 'node:net'
import WebSocket from 'ws'
import { INSPECTOR_CONNECT_RETRIES, INSPECTOR_RETRY_DELAY_MS } from '../config.js'
import { logger } from '../logger.js'

// DO NOT DELETE - Inspector /json endpoint response example:
// [{ description, devtoolsFrontendUrl, devtoolsFrontendUrlCompat, faviconUrl, id, title, type, url, webSocketDebuggerUrl }]
interface InspectorInfo {
	description: string
	devtoolsFrontendUrl: string
	id: string
	title: string
	type: string
	url: string
	webSocketDebuggerUrl: string
}

interface RequestContext {
	resolve: (value: any) => void
	reject: (reason: Error) => void
}

export class InspectorSession extends EventEmitter {
	private client!: WebSocket
	private requestId = 1
	private requestContext: Record<number, RequestContext> = {}
	private inspectorInfo!: InspectorInfo

	// SIGUSR1 触发目标进程激活 V8 Inspector，随后轮询探测端口是否就绪。
	// 同时探测 127.0.0.1 和 ::1，因为不同 Node 版本/OS 默认绑定地址不同。
	async open(pid: number, port: number): Promise<void> {
		try {
			process.kill(pid, 'SIGUSR1')
		} catch (e) {
			throw new Error(`failed to start inspector: ${(e as Error).message}`)
		}
		const detect = (host: string): Promise<boolean> => {
			return new Promise((resolve) => {
				const socket = net.connect(port, host)
				socket.on('connect', () => {
					socket.destroy()
					resolve(true)
				})
				socket.on('error', () => {
					resolve(false)
				})
			})
		}
		let i = INSPECTOR_CONNECT_RETRIES
		while (i--) {
			if (await detect('127.0.0.1')) break
			if (await detect('::1')) break
			await new Promise((resolve) => setTimeout(resolve, INSPECTOR_RETRY_DELAY_MS))
			if (i === 0) throw new Error('failed to start inspector: timeout')
		}
	}

	async connect(port: number): Promise<void> {
		this.inspectorInfo = await this.getInspectorInfo(port)
		this.client = await this.connectWebSocket(port)
		this.listenMessages()
		logger.debug('connect to inspector successfully')
	}

	async evaluate(expression: string): Promise<any> {
		const result = await this.sendMessage('Runtime.evaluate', {
			expression,
			includeCommandLineAPI: true,
			awaitPromise: true,
		})
		if (result.result.subtype === 'error') {
			throw new Error(result.result.description)
		}
		const ret = JSON.parse(result.result.value)
		if (ret.code === 0) {
			return ret.data
		}
		throw new Error(ret.message)
	}

	sendMessage(method: string, params?: Record<string, any>): Promise<any> {
		const msg = { method, params, id: this.requestId++ }
		return new Promise((resolve, reject) => {
			this.requestContext[msg.id] = { resolve, reject }
			this.client.send(JSON.stringify(msg))
		})
	}

	// 关闭目标进程的 Inspector 线程，端口停止监听。
	// 注意：这不会终止目标进程，仅关闭调试接口。
	closeInspector(): Promise<any> {
		return this.evaluate(`
			(function() {
				try {
					require('inspector').close();
					return JSON.stringify({code : 0});
				} catch (e) {
					return JSON.stringify({code : -1, message: e.message});
				}
			})();
		`)
	}

	close(): void {
		if (this.client) {
			this.client.close()
		}
	}

	private getInspectorInfo(port: number): Promise<InspectorInfo> {
		return new Promise((resolve, reject) => {
			const errorHandler = (e: Error) => {
				reject(new Error(`failed to get inspector info: ${e.message}`))
			}
			const client = http.get(`http://127.0.0.1:${port}/json`, (res) => {
				let chunk: Buffer | null = null
				res.on('data', (data) => {
					chunk = chunk ? Buffer.concat([data, chunk]) : data
				})
				res.on('end', () => {
					try {
						const data: InspectorInfo[] = JSON.parse(chunk!.toString())
						resolve(data[0])
					} catch (e) {
						errorHandler(e as Error)
					}
				})
				res.on('error', errorHandler)
			})
			client.on('error', errorHandler)
		})
	}

	private connectWebSocket(port: number): Promise<WebSocket> {
		return new Promise((resolve, reject) => {
			const errorHandler = (e: Error) => {
				reject(new Error(`failed to connect to inspector: ${e.message}`))
			}
			try {
				const ws = new WebSocket(`ws://127.0.0.1:${port}/${this.inspectorInfo.id}`)
				ws.on('open', () => resolve(ws))
				ws.on('error', errorHandler)
			} catch (e) {
				errorHandler(e as Error)
			}
		})
	}

	private listenMessages(): void {
		this.client.on('message', (message) => {
			try {
				const { id, error, result, method, params } = JSON.parse(message.toString())
				if (id) {
					const context = this.requestContext[id]
					if (context) {
						delete this.requestContext[id]
						if (error) {
							context.reject(new Error(`${error.code}: ${error.message}`))
						} else {
							context.resolve(result)
						}
					}
				} else {
					this.emit(method, params)
				}
			} catch (e) {
				logger.error('failed to parse inspector message', e)
			}
		})
	}
}

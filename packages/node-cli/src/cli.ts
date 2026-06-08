import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import { EventEmitter } from 'events'
import { render } from 'ink'
import React from 'react'
import WebSocket from 'ws'
import CPUGraph from './CPUGraph.js'
import { INSPECTOR_CONNECT_RETRIES, INSPECTOR_RETRY_DELAY_MS } from './config.js'
import { COMMAND_TYPE } from './constants.js'
import { FUNCTION_WRAPPER, genFilename } from './helper.js'
import { logger } from './logger.js'
import type { CLIRuntimeOptions, CommandOptions } from './types/index.js'

// DO NOT DELETE - Inspector /json endpoint response example:
// [
// 	{
// 		description: 'node.js instance',
// 		devtoolsFrontendUrl:
// 			'devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=127.0.0.1:9229/02bad627-0e7f-4a7f-ae1c-99957ac4fc25',
// 		devtoolsFrontendUrlCompat:
// 			'devtools://devtools/bundled/inspector.html?experiments=true&v8only=true&ws=127.0.0.1:9229/02bad627-0e7f-4a7f-ae1c-99957ac4fc25',
// 		faviconUrl: 'https://nodejs.org/static/images/favicons/favicon.ico',
// 		id: '02bad627-0e7f-4a7f-ae1c-99957ac4fc25',
// 		title: 'listen_server.mjs',
// 		type: 'node',
// 		url: 'file:///Users/bytedance/Desktop/github/mitojs-node/demos/listen_server.mjs',
// 		webSocketDebuggerUrl: 'ws://127.0.0.1:9229/02bad627-0e7f-4a7f-ae1c-99957ac4fc25',
// 	},
// ]
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

export class CLI extends EventEmitter {
	private options: CLIRuntimeOptions
	private client!: WebSocket
	private requestId = 1
	private requestContext: Record<number, RequestContext> = {}
	private inspectorInfo!: InspectorInfo
	private _lastCpuData: { user: number; system: number; hrtime: bigint } | null = null

	constructor(options: CLIRuntimeOptions) {
		super()
		this.options = options
	}

	async run() {
		try {
			await this.openInspector()
			this.inspectorInfo = await this.getInspectorInfo()
			this.client = await this.connectToInspector()
			this.listenInspectorMessage()
			logger.debug('connect to inspector successfully')
		} catch (e: any) {
			this.output({ success: false, command: this.options.cmd.commandType, error: e.message })
			process.exit(1)
		}
		const { cmd } = this.options
		try {
			switch (cmd.commandType) {
				case COMMAND_TYPE.CPU_PROFILE:
					await this.getCPUProfile(cmd)
					break
				case COMMAND_TYPE.HEAP_SNAPSHOT:
					await this.getHeapSnapshot(cmd)
					break
				case COMMAND_TYPE.REPORT:
					await this.getProcessReport(cmd)
					break
				case COMMAND_TYPE.MEMORY:
					await this.getMemoryInfo(cmd)
					break
				case COMMAND_TYPE.MONITOR_CPU:
					await this.getMonitorCPU(cmd)
					break
				// biome-ignore lint/suspicious/noFallthroughSwitchClause: process.exit() guarantees no fallthrough
				case COMMAND_TYPE.START_INSPECT:
					await this.startInspect(cmd)
					this.client.close()
					process.exit(0)
				case COMMAND_TYPE.STOP_INSPECT:
					// 先输出成功信息，再关闭 Inspector。
					// closeInspector 会导致 WebSocket 断连，evaluate 无法收到响应。
					this.output({
						success: true,
						command: 'stop-inspect',
						data: `Inspector of process ${this.options.pid} has been closed`,
					})
					this.closeInspector().catch(() => {})
					break
				case COMMAND_TYPE.RUN_CODE:
					await this.runCode(cmd)
					break
			}
		} catch (e) {
			this.output({ success: false, command: cmd.commandType, error: (e as Error).message })
		}

		this.closeInspector()
		this.client.close()
		process.exit(0)
	}

	private output(data: { success: boolean; command: string; data?: any; error?: string }) {
		if (this.options.json) {
			process.stdout.write(JSON.stringify(data) + '\n')
		} else if (data.success && data.data !== undefined) {
			if (typeof data.data === 'string') {
				console.log(data.data)
			} else {
				console.log(JSON.stringify(data.data, null, 4))
			}
		} else if (!data.success && data.error) {
			console.error(`Error: ${data.error}`)
		}
	}

	// SIGUSR1 触发目标进程激活 V8 Inspector，随后轮询探测端口是否就绪。
	// 同时探测 127.0.0.1 和 ::1，因为不同 Node 版本/OS 默认绑定地址不同。
	private async openInspector() {
		const { pid, port } = this.options
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
			if (await detect('127.0.0.1')) {
				return
			}
			if (await detect('::1')) {
				return
			}
			await new Promise((resolve) => setTimeout(resolve, INSPECTOR_RETRY_DELAY_MS))
		}
		throw new Error('failed to start inspector: timeout')
	}

	private getInspectorInfo(): Promise<InspectorInfo> {
		return new Promise((resolve, reject) => {
			const { port } = this.options
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

	private connectToInspector(): Promise<WebSocket> {
		return new Promise((resolve, reject) => {
			const errorHandler = (e: Error) => {
				reject(new Error(`failed to connect to inspector: ${e.message}`))
			}
			try {
				const ws = new WebSocket(`ws://127.0.0.1:${this.options.port}/${this.inspectorInfo!.id}`)
				ws.on('open', () => {
					resolve(ws)
				})
				ws.on('error', errorHandler)
			} catch (e) {
				errorHandler(e as Error)
			}
		})
	}

	private listenInspectorMessage() {
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

	private sendMessageToInspector(data: {
		method: string
		params?: Record<string, any>
		[key: string]: any
	}): Promise<any> {
		const msg = {
			...data,
			id: this.requestId++,
		}
		return new Promise((resolve, reject) => {
			this.requestContext[msg.id] = { resolve, reject }
			this.client.send(JSON.stringify(msg))
		})
	}

	// 关闭目标进程的 Inspector 线程，端口停止监听。
	// 注意：这不会终止目标进程，仅关闭调试接口。
	private closeInspector() {
		return this.evaluate({
			expression: `
                (function() {
                    try {
                        require('inspector').close();
                        return JSON.stringify({code : 0});
                    } catch (e) {
                        return JSON.stringify({code : -1, message: e.message});
                    }
                })();
        `,
		})
	}

	private async getCPUProfile(cmd: CommandOptions<COMMAND_TYPE.CPU_PROFILE>) {
		const { duration } = cmd.options
		return new Promise<void>((resolve, reject) => {
			this.sendMessageToInspector({ method: 'Profiler.enable' })
			this.sendMessageToInspector({ method: 'Profiler.start' })
			setTimeout(async () => {
				try {
					const data = await this.sendMessageToInspector({ method: 'Profiler.stop' })
					const filename = genFilename('cpuprofile')
					fs.writeFileSync(filename, JSON.stringify(data.profile))
					this.output({
						success: true,
						command: 'cpuprofile',
						data: { filename },
					})
					resolve()
				} catch (e) {
					reject(e)
				}
				this.sendMessageToInspector({ method: 'Profiler.disable' })
			}, ~~duration || 10000)
		})
	}

	private async getHeapSnapshot(cmd: CommandOptions<COMMAND_TYPE.HEAP_SNAPSHOT>) {
		const filename = genFilename('heapsnapshot')
		await this.evaluate({
			expression: FUNCTION_WRAPPER(
				`
                    const v8 = require('v8');
                    if (typeof v8.writeHeapSnapshot === 'function') {
                        v8.writeHeapSnapshot('${filename}');
                    } else {
                        throw new Error('Your Node.js version do not support v8.writeHeapSnapshot API.');
                    }
                `
			),
		})
		this.output({
			success: true,
			command: 'heapsnapshot',
			data: { filename },
		})
	}

	private async getProcessReport(cmd: CommandOptions<COMMAND_TYPE.REPORT>) {
		const filename = genFilename('json')
		await this.evaluate({
			expression: FUNCTION_WRAPPER(
				`
                    if (process.report && typeof process.report.writeReport === 'function') {
                        process.report.writeReport('${filename}');
                    } else {
                        throw new Error('Your Node.js version do not support process.report.writeReport API.');
                    }
                `
			),
		})
		this.output({ success: true, command: 'report', data: { filename } })
	}

	private async getMemoryInfo(cmd: CommandOptions<COMMAND_TYPE.MEMORY>) {
		const data = await this.evaluate({
			expression: FUNCTION_WRAPPER(`return process.memoryUsage();`),
		})
		this.output({ success: true, command: 'memory', data })
	}

	private async startInspect(cmd: CommandOptions<COMMAND_TYPE.START_INSPECT>) {
		const { url } = await this.evaluate({
			expression: FUNCTION_WRAPPER(
				`
                    const { url } = require('inspector');
                    return { url: url() };
                `
			),
		})
		const { host, pathname } = new URL(url)
		const devtoolsUrl = `devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=${host}${pathname}`
		this.output({ success: true, command: 'start-inspect', data: { devtoolsUrl } })
	}

	private async runCode(cmd: CommandOptions<COMMAND_TYPE.RUN_CODE>) {
		let code = cmd.options.code || cmd.options.file
		if (cmd.options.file && /\.js$/.test(cmd.options.file)) {
			code = fs.readFileSync(cmd.options.file, 'utf8')
		}

		if (!code) {
			throw new Error('No code or file provided')
		}

		const result = await this.evaluate({
			expression: FUNCTION_WRAPPER(code),
		})
		this.output({ success: true, command: 'run-code', data: result })
	}

	private async evaluate(options: { expression: string; [key: string]: any }): Promise<any> {
		const result = await this.sendMessageToInspector({
			method: 'Runtime.evaluate',
			params: {
				includeCommandLineAPI: true,
				awaitPromise: true,
				...options,
			},
		})
		if (result.result.subtype === 'error') {
			throw new Error(result.result.description)
		} else {
			const ret = JSON.parse(result.result.value)
			if (ret.code === 0) {
				return ret.data
			} else {
				throw new Error(ret.message)
			}
		}
	}

	private computeCPUPercent(data: { user: number; system: number; hrtime: string }): number {
		const current = { user: data.user, system: data.system, hrtime: BigInt(data.hrtime) }
		if (!this._lastCpuData) {
			this._lastCpuData = current
			return 0
		}
		const timeDiff = Number(current.hrtime - this._lastCpuData.hrtime) / 1e3
		const userDiff = current.user - this._lastCpuData.user
		const systemDiff = current.system - this._lastCpuData.system
		this._lastCpuData = current
		if (timeDiff <= 0) return 0
		return Math.min(((userDiff + systemDiff) / timeDiff) * 100, 100)
	}

	private async getMonitorCPU(cmd: CommandOptions<COMMAND_TYPE.MONITOR_CPU>) {
		const getCPUData = async (): Promise<number> => {
			const data = await this.evaluate({
				expression: FUNCTION_WRAPPER(`
					const usage = process.cpuUsage();
					const hrtime = process.hrtime.bigint();
					return { user: usage.user, system: usage.system, hrtime: hrtime.toString() };
				`),
			})
			return this.computeCPUPercent(data)
		}

		if (this.options.json) {
			// NDJSON 模式：每秒输出一行 JSON
			while (true) {
				try {
					const cpuPercent = await getCPUData()
					process.stdout.write(
						JSON.stringify({ success: true, command: 'monitor-cpu', data: { cpuPercent, timestamp: Date.now() } }) +
							'\n'
					)
				} catch {
					break
				}
				await new Promise((resolve) => setTimeout(resolve, 1000))
			}
		} else {
			render(React.createElement(CPUGraph, { getCPUData }))
			await new Promise(() => {})
		}
	}
}

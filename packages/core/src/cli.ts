import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import { EventEmitter } from 'events'
import WebSocket from 'ws'
import { CHROME_DEV_TASK_TYPE, COMMAND_TYPE } from './constants'
import { FUNCTION_WRAPPER, genFilename, getDevToolsUrl, upload } from './helper'
import type { CLIRuntimeOptions, CommandOptions } from './types'

interface InspectorInfo {
	description: string
	devtoolsFrontendUrl: string
	id: string
	title: string
	type: string
	url: string
	webSocketDebuggerUrl: string
}

export class CLI extends EventEmitter {
	private options: CLIRuntimeOptions
	private client!: WebSocket
	private requestId = 1
	private requestContext = {}
	private inspectorInfo!: InspectorInfo
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
			// console.log('connect to inspector successfully\n')
		} catch (e: any) {
			console.error(e.message)
			process.exit(0)
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
				// biome-ignore lint/suspicious/noFallthroughSwitchClause: <explanation>
				case COMMAND_TYPE.START_INSPECT:
					await this.startInspect(cmd)
					this.client.close()
					process.exit(0)
				case COMMAND_TYPE.STOP_INSPECT:
					break
				case COMMAND_TYPE.RUN_CODE:
					await this.runCode(cmd)
					break
				default:
					console.error(`invalid cmd: ${cmd}`)
					console.log(`execute ${cmd} successfully\n`)
			}
		} catch (e) {
			console.error(`failed to execute cmd: ${cmd}: ${(e as Error).message}`)
		}

		this.closeInspector()
		this.client.close()
		process.exit(0)
	}

	private async openInspector() {
		const { pid, port } = this.options
		try {
			process.kill(pid, 'SIGUSR1')
		} catch (e) {
			throw new Error(`failed to start inspector: ${(e as Error).message}`)
		}
		const detect = (host: string) => {
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
		let i = 10
		while (i--) {
			if (await detect('127.0.0.1')) {
				return
			}
			if (await detect('::1')) {
				return
			}
			await new Promise((resolve) => setTimeout(resolve, 500))
		}
		throw new Error('failed to start inspector: timeout')
	}

	private getInspectorInfo(): Promise<InspectorInfo> {
		return new Promise((resolve, reject) => {
			const { port } = this.options
			const errorHandler = (e) => {
				reject(new Error(`failed to get inspector info: ${e.message}`))
			}
			const client = http.get(`http://127.0.0.1:${port}/json`, (res) => {
				let chunk: Buffer | null = null
				res.on('data', (data) => {
					chunk = chunk ? Buffer.concat([data, chunk]) : data
				})
				res.on('end', () => {
					try {
						/**
                         * [
                                {
                                    "description": "",
                                    "devtoolsFrontendUrl": "/devtools/inspector.html?ws=localhost:9222/devtools/page/DAB7FB6187B554E10B0BD18821265734",
                                    "id": "DAB7FB6187B554E10B0BD18821265734",
                                    "title": "Yahoo",
                                    "type": "page",
                                    "url": "https://www.yahoo.com/",
                                    "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/DAB7FB6187B554E10B0BD18821265734"
                                }
                            ]
                        */
						const data = JSON.parse(chunk!.toString())
						resolve(data[0])
					} catch (e) {
						errorHandler(e)
					}
				})
				res.on('error', errorHandler)
			})
			client.on('error', errorHandler)
		})
	}

	private connectToInspector(): Promise<WebSocket> {
		return new Promise((resolve, reject) => {
			const errorHandler = (e) => {
				reject(new Error(`failed to connect to inspector: ${e.message}`))
			}
			try {
				const ws = new WebSocket(`ws://127.0.0.1:${this.options.port}/${this.inspectorInfo!.id}`)
				ws.on('open', () => {
					resolve(ws)
				})
				ws.on('error', errorHandler)
			} catch (e) {
				errorHandler(e)
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
				console.error(e)
			}
		})
	}

	private sendMessageToInspector(data: { [key: string]: any }): any {
		data = {
			...data,
			id: this.requestId++,
		}
		return new Promise((resolve, reject) => {
			this.requestContext[data.id] = {
				resolve,
				reject,
			}
			this.client.send(JSON.stringify(data))
		})
	}

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
		return new Promise((resolve, reject) => {
			this.sendMessageToInspector({ method: 'Profiler.enable' })
			this.sendMessageToInspector({ method: 'Profiler.start' })
			setTimeout(async () => {
				try {
					const data = await this.sendMessageToInspector({ method: 'Profiler.stop' })
					const filename = genFilename('cpuprofile')
					fs.writeFileSync(filename, JSON.stringify(data.profile))
					await upload(filename)
					resolve(null)
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
		const { dest } = await upload(filename)
		console.log(`Online Analysis Url: ${getDevToolsUrl({ filename: CHROME_DEV_TASK_TYPE.HEAP_SNAPSHOT, dest })}\n`)
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
		const { url } = await upload(filename)
		console.log(`Online Report Data Url: ${url}\n`)
	}

	private async getMemoryInfo(cmd: CommandOptions<COMMAND_TYPE.MEMORY>) {
		const data = await this.evaluate({
			expression: FUNCTION_WRAPPER(
				`
                    return process.memoryUsage();
                `
			),
		})
		console.log(`process memory info: ${JSON.stringify(data, null, 4)}`)
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
		console.log('debugging Node.js by enter this url in your browser:\n')
		console.log(`devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=${host}${pathname}\n`)
	}

	private async runCode(cmd: CommandOptions<COMMAND_TYPE.RUN_CODE>) {
		// cmd : file | code
		// todo 支持文件
		// todo 支持代码
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
		console.log(result)
	}

	private async evaluate(options): Promise<any> {
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
}

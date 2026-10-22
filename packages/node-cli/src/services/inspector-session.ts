import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as http from 'node:http'
import { promisify } from 'node:util'
import WebSocket from 'ws'

// DO NOT DELETE - Inspector /json endpoint response example:
// [{ description, devtoolsFrontendUrl, devtoolsFrontendUrlCompat, faviconUrl, id, title, type, url, webSocketDebuggerUrl }]
interface InspectorInfo {
	id: string
	webSocketDebuggerUrl: string
}
interface RequestContext {
	resolve: (value: any) => void
	reject: (reason: Error) => void
	timer: ReturnType<typeof setTimeout>
}
export enum InspectorErrorCode {
	SIGNAL_FAILED = 'SIGNAL_FAILED',
	TIMEOUT = 'TIMEOUT',
	PORT_UNREACHABLE = 'PORT_UNREACHABLE',
	WEBSOCKET_FAILED = 'WEBSOCKET_FAILED',
	INFO_FETCH_FAILED = 'INFO_FETCH_FAILED',
	TARGET_MISMATCH = 'TARGET_MISMATCH',
	UNSUPPORTED_PLATFORM = 'UNSUPPORTED_PLATFORM',
}
export class InspectorError extends Error {
	constructor(
		public code: InspectorErrorCode,
		message: string,
		public suggestion = 'Verify the target process and Inspector port.'
	) {
		super(message)
	}
}

export class InspectorSession extends EventEmitter {
	private client?: WebSocket
	private requestId = 1
	private requests = new Map<number, RequestContext>()
	private inspectorInfo?: InspectorInfo
	private targetPid?: number
	private port = 9229
	private ownsInspector = false
	private timeout: number
	private abortHandler = () => {
		for (const request of this.requests.values()) {
			clearTimeout(request.timer)
			request.reject(this.abortError())
		}
		this.requests.clear()
	}

	constructor(private options: { timeout?: number; signal?: AbortSignal } = {}) {
		super()
		this.timeout = options.timeout ?? 30000
		options.signal?.addEventListener('abort', this.abortHandler, { once: true })
	}

	async open(pid: number, port: number): Promise<void> {
		this.throwIfAborted()
		this.targetPid = pid
		this.port = port
		try {
			this.inspectorInfo = await this.getInspectorInfo(port)
			return
		} catch (error) {
			if (!(error instanceof InspectorError) || error.code !== InspectorErrorCode.PORT_UNREACHABLE) throw error
		}
		this.throwIfAborted()
		// Windows cannot activate Inspector with SIGUSR1; an already-open endpoint remains supported.
		if (process.platform === 'win32')
			throw new InspectorError(
				InspectorErrorCode.UNSUPPORTED_PLATFORM,
				'Start the Windows target with --inspect before connecting.',
				'Use node --inspect=<port> app.js.'
			)
		try {
			// SIGUSR1 can terminate unrelated executables; verify Node before sending a process signal.
			const { stdout } = await promisify(execFile)('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 2000 })
			if (!/(?:^|[/\\])node(?:js)?(?:$|\s)/i.test(stdout.trim())) throw new Error('Target executable is not Node.js')
			this.throwIfAborted()
			process.kill(pid, 'SIGUSR1')
			this.ownsInspector = true
		} catch (error) {
			if (this.options.signal?.aborted) throw this.abortError()
			throw new InspectorError(
				InspectorErrorCode.SIGNAL_FAILED,
				`Cannot activate Inspector for PID ${pid}: ${(error as Error).message}`,
				'Choose a Node.js process owned by the current user, or start its Inspector explicitly.'
			)
		}
		const deadline = Date.now() + Math.min(this.timeout, 5000)
		while (Date.now() < deadline) {
			this.throwIfAborted()
			try {
				this.inspectorInfo = await this.getInspectorInfo(port)
				return
			} catch (error) {
				if (error instanceof InspectorError && error.code !== InspectorErrorCode.PORT_UNREACHABLE) throw error
			}
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
		throw new InspectorError(
			InspectorErrorCode.TIMEOUT,
			`Inspector startup timeout on port ${port}`,
			'--port connects to the target configured Inspector port. Configure the target with --inspect-port=<port>.'
		)
	}

	async connect(port: number): Promise<void> {
		this.throwIfAborted()
		this.port = port
		this.inspectorInfo ??= await this.getInspectorInfo(port)
		const url = new URL(this.inspectorInfo.webSocketDebuggerUrl)
		if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port) !== port) {
			throw new InspectorError(InspectorErrorCode.INFO_FETCH_FAILED, 'Inspector returned a non-local debugger endpoint')
		}
		this.client = await new Promise<WebSocket>((resolve, reject) => {
			const socket = new WebSocket(url, { handshakeTimeout: Math.min(this.timeout, 5000) })
			const abort = () => {
				socket.terminate()
				reject(this.abortError())
			}
			this.options.signal?.addEventListener('abort', abort, { once: true })
			socket.once('open', () => {
				this.options.signal?.removeEventListener('abort', abort)
				resolve(socket)
			})
			socket.once('error', (error) => {
				this.options.signal?.removeEventListener('abort', abort)
				reject(new InspectorError(InspectorErrorCode.WEBSOCKET_FAILED, error.message))
			})
		})
		this.listenMessages()
		if (this.targetPid !== undefined) {
			const response = await this.sendMessage('Runtime.evaluate', { expression: 'process.pid', returnByValue: true })
			if (response.result?.value !== this.targetPid) {
				this.ownsInspector = false
				this.close()
				throw new InspectorError(
					InspectorErrorCode.TARGET_MISMATCH,
					`Inspector PID does not match requested process ${this.targetPid}`
				)
			}
		}
	}

	async evaluate(expression: string): Promise<any> {
		const result = await this.sendMessage('Runtime.evaluate', {
			expression,
			includeCommandLineAPI: true,
			awaitPromise: true,
			returnByValue: true,
		})
		if (result.exceptionDetails || result.result?.subtype === 'error')
			throw new Error(
				result.exceptionDetails?.exception?.description ?? result.result?.description ?? 'Target evaluation failed'
			)
		const envelope = JSON.parse(result.result.value)
		if (envelope.code === 0) return envelope.data
		throw new Error(envelope.message ?? 'Target evaluation failed')
	}

	sendMessage(method: string, params?: Record<string, any>, options?: { cleanup?: boolean }): Promise<any> {
		if (!options?.cleanup) this.throwIfAborted()
		const socket = this.client
		if (!socket || socket.readyState !== WebSocket.OPEN)
			return Promise.reject(new Error('Inspector connection is closed'))
		const id = this.requestId++
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => {
					this.requests.delete(id)
					reject(new InspectorError(InspectorErrorCode.TIMEOUT, `Inspector command timeout: ${method}`))
				},
				options?.cleanup ? Math.min(this.timeout, 1000) : this.timeout
			)
			this.requests.set(id, { resolve, reject, timer })
			socket.send(JSON.stringify({ method, params, id }), (error) => {
				if (error) {
					clearTimeout(timer)
					this.requests.delete(id)
					reject(error)
				}
			})
		})
	}

	/** Release our connection; preserve a debugger that existed before this session. */
	async dispose(keepOpen = false): Promise<void> {
		const signal = this.options.signal
		const timeout = this.timeout
		try {
			if (!this.ownsInspector || keepOpen) return
			// SIGUSR1 may have succeeded before cancellation interrupted discovery or the handshake.
			// Recover a bounded, PID-verified cleanup connection even when no original socket was opened.
			this.options.signal = undefined
			this.timeout = Math.min(timeout, 500)
			const deadline = Date.now() + 2000
			while (this.client?.readyState !== WebSocket.OPEN) {
				try {
					await this.connect(this.port)
				} catch (error) {
					this.client?.terminate()
					this.client = undefined
					if (!this.ownsInspector || Date.now() >= deadline) throw error
					await new Promise((resolve) => setTimeout(resolve, 25))
				}
			}
			await this.closeInspector()
		} finally {
			this.options.signal = signal
			this.timeout = timeout
			this.close()
		}
	}

	async closeInspector(): Promise<void> {
		if (this.client?.readyState !== WebSocket.OPEN) return
		// Node >=20.19 supports synchronous getBuiltinModule in both ESM and CJS.
		// A temporary async Promise can be collected before CDP awaits it under GC pressure; return a primitive.
		// inspector.close waits for peers, so schedule it after replying and disconnect our peer.
		await this.sendMessage(
			'Runtime.evaluate',
			{
				expression: `(()=>{const inspector = process.getBuiltinModule('node:inspector'); setTimeout(()=>inspector.close(), 25); return JSON.stringify({code:0});})()`,
			},
			{ cleanup: true }
		)
		this.close()
		// Discovery cleanup must not inherit the cancelled command's signal.
		const cancelledSignal = this.options.signal
		this.options.signal = undefined
		const deadline = Date.now() + Math.min(this.timeout, 2000)
		while (Date.now() < deadline) {
			try {
				await this.getInspectorInfo(this.port)
			} catch (error) {
				if (error instanceof InspectorError && error.code === InspectorErrorCode.PORT_UNREACHABLE) {
					this.ownsInspector = false
					this.options.signal = cancelledSignal
					return
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 30))
		}
		this.options.signal = cancelledSignal
		throw new InspectorError(InspectorErrorCode.TIMEOUT, 'Inspector shutdown timeout')
	}

	close(): void {
		this.options.signal?.removeEventListener('abort', this.abortHandler)
		const error = this.options.signal?.aborted ? this.abortError() : new Error('Inspector connection closed')
		for (const request of this.requests.values()) {
			clearTimeout(request.timer)
			request.reject(error)
		}
		this.requests.clear()
		this.client?.terminate()
		this.client = undefined
	}

	private abortError(): Error {
		return this.options.signal?.reason instanceof Error
			? this.options.signal.reason
			: new DOMException('Operation cancelled', 'AbortError')
	}
	private throwIfAborted() {
		if (this.options.signal?.aborted) throw this.abortError()
	}

	private getInspectorInfo(port: number): Promise<InspectorInfo> {
		return new Promise((resolve, reject) => {
			this.throwIfAborted()
			let body = ''
			let finished = false
			let deadline: ReturnType<typeof setTimeout> | undefined
			const signal = this.options.signal
			const finish = (error?: Error, info?: InspectorInfo) => {
				if (finished) return
				finished = true
				if (deadline) clearTimeout(deadline)
				signal?.removeEventListener('abort', abort)
				if (error) reject(error)
				else resolve(info!)
			}
			const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
				res.setEncoding('utf8')
				res.on('data', (chunk) => {
					body += chunk
					if (body.length > 1024 * 1024) {
						finish(new InspectorError(InspectorErrorCode.INFO_FETCH_FAILED, 'Inspector discovery response too large'))
						req.destroy()
					}
				})
				res.on('error', (error) => finish(new InspectorError(InspectorErrorCode.INFO_FETCH_FAILED, error.message)))
				res.on('end', () => {
					try {
						const target = JSON.parse(body)[0]
						if (res.statusCode !== 200 || !target?.id || !target.webSocketDebuggerUrl)
							throw new Error('No debugger target')
						finish(undefined, target)
					} catch (error) {
						finish(
							new InspectorError(
								InspectorErrorCode.INFO_FETCH_FAILED,
								`Invalid Inspector discovery: ${(error as Error).message}`
							)
						)
					}
				})
			})
			const abort = () => {
				finish(this.abortError())
				req.destroy()
			}
			// Bound wall time rather than socket idle time: incomplete JSON can arrive forever.
			deadline = setTimeout(
				() => {
					finish(new InspectorError(InspectorErrorCode.TIMEOUT, 'Inspector discovery timeout'))
					req.destroy()
				},
				Math.min(this.timeout, 1000)
			)
			signal?.addEventListener('abort', abort, { once: true })
			req.on('error', (error) =>
				finish(new InspectorError(InspectorErrorCode.PORT_UNREACHABLE, `Inspector unavailable: ${error.message}`))
			)
		})
	}

	private listenMessages(): void {
		this.client!.on('close', () => {
			for (const request of this.requests.values()) {
				clearTimeout(request.timer)
				request.reject(new Error('Inspector disconnected'))
			}
			this.requests.clear()
		})
		this.client!.on('error', () => {})
		this.client!.on('message', (message) => {
			try {
				const { id, error, result, method, params } = JSON.parse(message.toString())
				if (id) {
					const request = this.requests.get(id)
					if (!request) return
					clearTimeout(request.timer)
					this.requests.delete(id)
					if (error) request.reject(new Error(`${error.code}: ${error.message}`))
					else request.resolve(result)
				} else if (typeof method === 'string') this.emit(method, params)
			} catch {
				this.close()
			}
		})
	}
}

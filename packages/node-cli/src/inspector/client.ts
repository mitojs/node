interface InspectorSocket {
	on(event: 'message', listener: (message: Buffer | string) => void): void
	on(event: 'close' | 'error', listener: (error?: Error) => void): void
	send(message: string): void
	close(): void
}

interface PendingRequest {
	resolve: (value: unknown) => void
	reject: (error: Error) => void
	timer: NodeJS.Timeout
}

interface InspectorResponse {
	id?: number
	result?: unknown
	error?: {
		code?: number
		message?: string
	}
}

interface RuntimeEvaluateResult {
	result?: {
		subtype?: string
		description?: string
		value?: unknown
	}
	exceptionDetails?: {
		text?: string
		exception?: {
			description?: string
		}
	}
}

const DEFAULT_TIMEOUT_MS = 10000

export class InspectorClient {
	private requestId = 1
	private pendingRequests = new Map<number, PendingRequest>()

	constructor(private readonly socket: InspectorSocket) {
		this.socket.on('message', (message) => {
			this.handleMessage(message)
		})
		this.socket.on('close', () => {
			this.rejectAll(new Error('inspector connection closed'))
		})
		this.socket.on('error', (error) => {
			this.rejectAll(error || new Error('inspector connection error'))
		})
	}

	send<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
		const id = this.requestId++
		const payload = JSON.stringify({ id, method, params })

		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(id)
				reject(new Error(`inspector request timeout: ${method}`))
			}, timeoutMs)

			this.pendingRequests.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timer,
			})
			this.socket.send(payload)
		})
	}

	async evaluate<T = unknown>(expression: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
		const result = await this.send<RuntimeEvaluateResult>(
			'Runtime.evaluate',
			{
				expression,
				awaitPromise: true,
				includeCommandLineAPI: true,
				returnByValue: true,
			},
			timeoutMs
		)

		if (result.exceptionDetails) {
			throw new Error(
				result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed'
			)
		}

		if (result.result?.subtype === 'error') {
			throw new Error(result.result.description || 'Runtime.evaluate returned an error')
		}

		return result.result?.value as T
	}

	close() {
		this.socket.close()
	}

	private handleMessage(message: Buffer | string) {
		let response: InspectorResponse

		try {
			response = JSON.parse(message.toString())
		} catch {
			return
		}

		if (!response.id) {
			return
		}

		const pending = this.pendingRequests.get(response.id)
		if (!pending) {
			return
		}

		clearTimeout(pending.timer)
		this.pendingRequests.delete(response.id)

		if (response.error) {
			pending.reject(new Error(`${response.error.code ?? 'ERR'}: ${response.error.message || 'Inspector error'}`))
			return
		}

		pending.resolve(response.result)
	}

	private rejectAll(error: Error) {
		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timer)
			pending.reject(error)
			this.pendingRequests.delete(id)
		}
	}
}

import * as http from 'node:http'

export interface MetricsData {
	cpu?: { load: number; useLoad: number } | null
	memory?: { heapInfo: any; heapSpaces: any; memory: NodeJS.MemoryUsage } | null
	errors?: any[]
	timers?: any[]
	last_updated?: number
}

export interface ProcessInfo {
	metrics: MetricsData | null
	registeredSubjects: string[]
	updatedAt: Record<string, number>
	intervals: Record<string, number>
	truncated: { errors: number; timers: number }
}

export class AgentClient {
	private baseUrls: string[]
	constructor(
		port = Number(process.env.MITO_AGENT_TCP_PORT) || 16666,
		private options: { timeout?: number; signal?: AbortSignal } = {}
	) {
		this.baseUrls = [`http://127.0.0.1:${port}`, `http://[::1]:${port}`]
	}

	async isAvailable(): Promise<boolean> {
		for (const baseUrl of this.baseUrls) {
			const res = await this.fetchFrom(baseUrl, '/info')
			// A valid JSON response alone must never authorize attaching to a different local service.
			if (res?.name === 'mitojs-agent' && res.protocol_version === 1 && res.status === 'running') {
				this.baseUrls = [baseUrl]
				return true
			}
		}
		return false
	}

	async getMetrics(pid: number): Promise<MetricsData | null> {
		return (await this.getProcessInfo(pid))?.metrics ?? null
	}

	async getProcessInfo(pid: number): Promise<ProcessInfo | null> {
		const res = await this.fetchFrom(this.baseUrls[0], `/metrics/${pid}`)
		if (!res?.success) return null
		return {
			metrics: res.data ?? null,
			registeredSubjects: res.registered_subjects ?? [],
			updatedAt: res.updated_at ?? {},
			intervals: res.intervals ?? {},
			truncated: { errors: res.truncated?.errors ?? 0, timers: res.truncated?.timers ?? 0 },
		}
	}

	private fetchFrom(baseUrl: string, path: string): Promise<any> {
		return new Promise((resolve, reject) => {
			const signal = this.options.signal
			if (signal?.aborted) {
				reject(signal.reason ?? new DOMException('Operation cancelled', 'AbortError'))
				return
			}
			let finished = false
			let deadline: ReturnType<typeof setTimeout> | undefined
			const done = (data: any) => {
				if (finished) return
				finished = true
				if (deadline) clearTimeout(deadline)
				signal?.removeEventListener('abort', abort)
				resolve(data)
			}
			const abort = () => {
				if (finished) return
				finished = true
				if (deadline) clearTimeout(deadline)
				req.destroy()
				signal?.removeEventListener('abort', abort)
				reject(signal?.reason ?? new DOMException('Operation cancelled', 'AbortError'))
			}
			const req = http.get(`${baseUrl}${path}`, { timeout: Math.min(this.options.timeout ?? 2000, 2000) }, (res) => {
				let body = ''
				res.setEncoding('utf8')
				res.on('data', (chunk) => {
					body += chunk
					if (body.length > 1024 * 1024) {
						req.destroy()
						done(null)
					}
				})
				res.on('error', () => done(null))
				res.on('end', () => {
					if (res.statusCode !== 200) {
						done(null)
						return
					}
					try {
						done(JSON.parse(body))
					} catch {
						done(null)
					}
				})
			})
			// Socket inactivity alone never bounds a peer that keeps sending incomplete JSON.
			deadline = setTimeout(
				() => {
					req.destroy()
					done(null)
				},
				Math.min(this.options.timeout ?? 2000, 2000)
			)
			req.on('error', () => done(null))
			req.on('timeout', () => {
				req.destroy()
				done(null)
			})
			signal?.addEventListener('abort', abort, { once: true })
		})
	}
}

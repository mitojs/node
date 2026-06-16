import * as http from 'node:http'

export interface MetricsData {
	cpu?: { load: number; useLoad: number }
	memory?: { heapInfo: any; heapSpaces: any; memory: any }
	errors?: any[]
	timers?: any[]
	last_updated?: number
}

export interface ProcessInfo {
	metrics: MetricsData | null
	registeredSubjects: string[]
}

export class AgentClient {
	private baseUrls: string[]

	constructor(port = 16666) {
		// Agent 可能绑定在 IPv4 或 IPv6，两个都尝试
		this.baseUrls = [`http://127.0.0.1:${port}`, `http://[::1]:${port}`]
	}

	async isAvailable(): Promise<boolean> {
		for (const baseUrl of this.baseUrls) {
			try {
				const res = await this.fetchFrom(baseUrl, '/info')
				if (res !== null) {
					this.baseUrls = [baseUrl]
					return true
				}
			} catch {}
		}
		return false
	}

	async getMetrics(pid: number): Promise<MetricsData | null> {
		try {
			const res = await this.fetch(`/metrics/${pid}`)
			if (res && res.success && res.data) {
				return res.data as MetricsData
			}
		} catch {}
		return null
	}

	async getProcessInfo(pid: number): Promise<ProcessInfo | null> {
		try {
			const res = await this.fetch(`/metrics/${pid}`)
			if (res && res.success) {
				return {
					metrics: res.data ?? null,
					registeredSubjects: res.registered_subjects ?? [],
				}
			}
		} catch {}
		return null
	}

	private fetch(path: string): Promise<any> {
		return this.fetchFrom(this.baseUrls[0], path)
	}

	private fetchFrom(baseUrl: string, path: string): Promise<any> {
		return new Promise((resolve) => {
			const req = http.get(`${baseUrl}${path}`, { timeout: 2000 }, (res) => {
				let body = ''
				res.on('data', (chunk) => {
					body += chunk
				})
				res.on('end', () => {
					try {
						resolve(JSON.parse(body))
					} catch {
						resolve(null)
					}
				})
			})
			req.on('error', () => resolve(null))
			req.on('timeout', () => {
				req.destroy()
				resolve(null)
			})
		})
	}
}

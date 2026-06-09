import * as http from 'node:http'
import { AgentClient } from '../../services/agent-client'

let mockServer: http.Server | null = null
let serverPort = 0

function startMockAgent(
	handlers: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void>
): Promise<number> {
	return new Promise((resolve) => {
		mockServer = http.createServer((req, res) => {
			const handler = handlers[req.url || '']
			if (handler) {
				handler(req, res)
			} else {
				res.writeHead(404)
				res.end()
			}
		})
		mockServer.listen(0, '127.0.0.1', () => {
			const addr = mockServer!.address() as { port: number }
			serverPort = addr.port
			resolve(serverPort)
		})
	})
}

function stopMockAgent(): Promise<void> {
	return new Promise((resolve) => {
		if (mockServer) {
			mockServer.close(() => resolve())
			mockServer = null
		} else {
			resolve()
		}
	})
}

describe('AgentClient', () => {
	afterEach(async () => {
		await stopMockAgent()
	})

	describe('isAvailable', () => {
		it('should return true when Agent responds to /info', async () => {
			const port = await startMockAgent({
				'/info': (_req, res) => {
					res.writeHead(200, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ name: 'mitojs-agent', version: '0.1.0', status: 'running' }))
				},
			})
			const client = new AgentClient(port)
			const available = await client.isAvailable()
			expect(available).toBe(true)
		})

		it('should return false when Agent is not running', async () => {
			const client = new AgentClient(19999)
			const available = await client.isAvailable()
			expect(available).toBe(false)
		})
	})

	describe('getMetrics', () => {
		it('should return metrics data when Agent has data for the PID', async () => {
			const mockMetrics = {
				cpu: { load: 25.5, useLoad: 18.3 },
				memory: { rss: 50000000, heapTotal: 20000000, heapUsed: 15000000 },
				errors: [],
				timers: [],
				last_updated: Date.now(),
			}
			const port = await startMockAgent({
				'/info': (_req, res) => {
					res.writeHead(200, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ name: 'mitojs-agent' }))
				},
				'/metrics/12345': (_req, res) => {
					res.writeHead(200, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ success: true, data: mockMetrics }))
				},
			})

			const client = new AgentClient(port)
			await client.isAvailable()
			const metrics = await client.getMetrics(12345)

			expect(metrics).not.toBeNull()
			expect(metrics!.cpu).toEqual({ load: 25.5, useLoad: 18.3 })
			expect(metrics!.memory).toBeDefined()
		})

		it('should return null when Agent has no data for the PID', async () => {
			const port = await startMockAgent({
				'/info': (_req, res) => {
					res.writeHead(200, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ name: 'mitojs-agent' }))
				},
				'/metrics/99999': (_req, res) => {
					res.writeHead(200, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ success: false, data: null }))
				},
			})

			const client = new AgentClient(port)
			await client.isAvailable()
			const metrics = await client.getMetrics(99999)

			expect(metrics).toBeNull()
		})

		it('should return null when Agent is not running', async () => {
			const client = new AgentClient(19999)
			const metrics = await client.getMetrics(12345)
			expect(metrics).toBeNull()
		})
	})
})

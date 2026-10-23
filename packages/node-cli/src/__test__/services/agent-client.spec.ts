import { createServer, type Server } from 'node:http'
import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentClient } from '../../services/agent-client.js'

const servers: Server[] = []
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})
const identity = { name: 'mitojs-agent', version: '0.1.0', protocol_version: 1, status: 'running', pid: process.pid }
const snapshot = {
	cpu: { load: 25.5, useLoad: 18.3 },
	memory: {
		heapInfo: getHeapStatistics(),
		heapSpaces: getHeapSpaceStatistics(),
		memory: { rss: 50000000, heapTotal: 20000000, heapUsed: 15000000, external: 1000, arrayBuffers: 500 },
	},
	errors: [],
	timers: [],
	last_updated: 1700000000000,
}
async function startAgent(metricsPayload: unknown = { success: false, data: null }) {
	const server = createServer((req, res) => {
		res.setHeader('content-type', 'application/json')
		res.end(JSON.stringify(req.url === '/info' ? identity : metricsPayload))
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	servers.push(server)
	return { server, port: (server.address() as { port: number }).port }
}
async function unusedPort() {
	const server = createServer()
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = (server.address() as { port: number }).port
	await new Promise<void>((resolve) => server.close(() => resolve()))
	return port
}

describe('Agent HTTP client', () => {
	it('recognizes a running protocol 1 Agent identity', async () => {
		const { port } = await startAgent()
		expect(await new AgentClient(port).isAvailable()).toBe(true)
	})
	it('reports an unavailable service on a closed local port', async () => {
		expect(await new AgentClient(await unusedPort()).isAvailable()).toBe(false)
	})
	it('returns the actual nested metric payload for a registered process', async () => {
		const { port } = await startAgent({
			success: true,
			data: snapshot,
			registered_subjects: ['CPU', 'Memory'],
			updated_at: { CPU: 1700000000000, Memory: 1700000000000 },
			intervals: { CPU: 1000, Memory: 5000 },
			truncated: { errors: 0, timers: 0 },
		})
		const client = new AgentClient(port)
		expect(await client.isAvailable()).toBe(true)
		expect(await client.getMetrics(12345)).toEqual(snapshot)
	})
	it('preserves registration, per-subject timestamps, intervals and truncation metadata', async () => {
		const { port } = await startAgent({
			success: true,
			data: snapshot,
			registered_subjects: ['CPU', 'Memory'],
			updated_at: { CPU: 1700000000000, Memory: 1700000000123 },
			intervals: { CPU: 1000, Memory: 5000 },
			truncated: { errors: 5, timers: 10 },
		})
		expect(await new AgentClient(port).getProcessInfo(12345)).toEqual({
			metrics: snapshot,
			registeredSubjects: ['CPU', 'Memory'],
			updatedAt: { CPU: 1700000000000, Memory: 1700000000123 },
			intervals: { CPU: 1000, Memory: 5000 },
			truncated: { errors: 5, timers: 10 },
		})
	})
	it('returns null when the Agent does not know the requested process', async () => {
		const { port } = await startAgent({ success: false, data: null, error: 'Process not found' })
		expect(await new AgentClient(port).getMetrics(99999)).toBeNull()
	})
	it('returns null for metrics when the Agent is unavailable', async () => {
		expect(await new AgentClient(await unusedPort()).getMetrics(12345)).toBeNull()
	})
})

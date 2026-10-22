import { createServer, type Server } from 'node:http'
import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8'
import { afterEach, describe, expect, it } from 'vitest'
import type { DiagnosticContext } from '../../core/types.js'
import { memoryPlugin } from '../../plugins/memory.js'
import { AgentClient } from '../../services/agent-client.js'
import type { InspectorSession } from '../../services/inspector-session.js'

const servers: Server[] = []
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})
const memory = {
	heapInfo: getHeapStatistics(),
	heapSpaces: getHeapSpaceStatistics(),
	memory: { rss: 90000000, heapTotal: 24000000, heapUsed: 7000000, external: 1000, arrayBuffers: 500 },
}
const inspectorMemory = {
	heapInfo: getHeapStatistics(),
	heapSpaces: getHeapSpaceStatistics(),
	memory: { rss: 41000000, heapTotal: 5000000, heapUsed: 3500000, external: 2000, arrayBuffers: 1000 },
}
async function agent(options: { data?: unknown; registered?: string[]; updated?: number; success?: boolean } = {}) {
	const server = createServer((req, res) => {
		res.setHeader('content-type', 'application/json')
		res.end(
			JSON.stringify(
				req.url === '/info'
					? { name: 'mitojs-agent', protocol_version: 1, version: '0.1.0', status: 'running', pid: process.pid }
					: {
							success: options.success ?? true,
							data: options.data ?? { cpu: null, memory, errors: [], timers: [], last_updated: Date.now() },
							registered_subjects: options.registered ?? ['Memory'],
							updated_at: { Memory: options.updated ?? Date.now() },
							intervals: { Memory: 1000 },
							truncated: { errors: 0, timers: 0 },
						}
			)
		)
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	servers.push(server)
	const client = new AgentClient((server.address() as { port: number }).port)
	expect(await client.isAvailable()).toBe(true)
	return client
}
function context(agentClient?: AgentClient, rejectInspector = false): DiagnosticContext {
	return {
		pid: 12345,
		port: 9229,
		json: true,
		agentClient,
		output: () => {},
		session: {
			evaluate: async () => {
				if (rejectInspector) throw new Error('Fresh Agent metrics must not require Inspector')
				return inspectorMemory
			},
		} as unknown as InspectorSession,
	}
}

describe('memory diagnostic data sources', () => {
	it('returns fresh nested Agent memory fields without requiring Inspector', async () => {
		expect(await memoryPlugin.execute(context(await agent(), true), {})).toEqual({
			success: true,
			data: { ...memory, source: 'agent' },
		})
	})
	it('returns actual Inspector details when the SDK is absent', async () => {
		expect(await memoryPlugin.execute(context(), {})).toEqual({
			success: true,
			data: { ...inspectorMemory, source: 'inspector' },
		})
	})
	it('falls back when a registered Agent has no memory snapshot', async () => {
		const client = await agent({
			data: { cpu: { load: 10, useLoad: 5 }, memory: null, errors: [], timers: [], last_updated: Date.now() },
		})
		expect(await memoryPlugin.execute(context(client), {})).toEqual({
			success: true,
			data: { ...inspectorMemory, source: 'inspector' },
		})
	})
	it('does not use a stale memory value as a current measurement', async () => {
		expect(await memoryPlugin.execute(context(await agent({ updated: Date.now() - 10000 })), {})).toEqual({
			success: true,
			data: { ...inspectorMemory, source: 'inspector' },
		})
	})
	it('requires a registered memory subject before trusting an Agent field', async () => {
		expect(await memoryPlugin.execute(context(await agent({ registered: ['CPU'] })), {})).toEqual({
			success: true,
			data: { ...inspectorMemory, source: 'inspector' },
		})
	})
	it('falls back when the Agent does not know the target process', async () => {
		expect(await memoryPlugin.execute(context(await agent({ success: false })), {})).toEqual({
			success: true,
			data: { ...inspectorMemory, source: 'inspector' },
		})
	})
})

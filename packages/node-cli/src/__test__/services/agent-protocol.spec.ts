import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentClient } from '../../services/agent-client'

const servers: http.Server[] = []
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})
async function agent(response: unknown) {
	const server = http.createServer((_req, res) => {
		res.setHeader('Content-Type', 'application/json')
		res.end(JSON.stringify(response))
	})
	servers.push(server)
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	return new AgentClient((server.address() as { port: number }).port)
}

describe('Agent protocol boundary', () => {
	it('rejects an unrelated JSON service on the configured port', async () => {
		expect(await (await agent({ name: 'other-service', protocol_version: 1 })).isAvailable()).toBe(false)
	})
	it('rejects an incompatible Agent protocol', async () => {
		expect(await (await agent({ name: 'mitojs-agent', protocol_version: 99, status: 'running' })).isAvailable()).toBe(
			false
		)
	})
	it('preserves per-subject timestamps and truncation information for readers', async () => {
		const client = await agent({
			success: true,
			data: { timers: [] },
			registered_subjects: ['Timeout'],
			updated_at: { Timeout: 1700000000000 },
			intervals: { Timeout: 5000 },
			truncated: { errors: 0, timers: 4 },
		})
		expect(await client.getProcessInfo(1234)).toMatchObject({
			updatedAt: { Timeout: 1700000000000 },
			intervals: { Timeout: 5000 },
			truncated: { timers: 4 },
		})
	})
})

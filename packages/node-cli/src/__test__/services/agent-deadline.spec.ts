import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentClient } from '../../services/agent-client'

let server: http.Server | undefined
afterEach(async () => {
	server?.closeAllConnections()
	if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
	server = undefined
})
describe('Agent response deadline', () => {
	it('ends a trickling response even when the socket is never idle', async () => {
		server = http.createServer((_req, res) => {
			res.write('{')
			const timer = setInterval(() => res.write(' '), 5)
			res.once('close', () => clearInterval(timer))
		})
		await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
		const client = new AgentClient((server.address() as { port: number }).port, { timeout: 30 })
		let limit: ReturnType<typeof setTimeout> | undefined
		const result = await Promise.race([
			client.isAvailable(),
			new Promise<string>((resolve) => {
				limit = setTimeout(() => resolve('still pending'), 200)
			}),
		])
		if (limit) clearTimeout(limit)
		expect(result).toBe(false)
	})
})

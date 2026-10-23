import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { DiagnosticContext } from '../../core/types.js'
import { timersPlugin } from '../../plugins/timers.js'
import { AgentClient } from '../../services/agent-client.js'
import type { InspectorSession } from '../../services/inspector-session.js'

const servers: Server[] = []
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})
const timers = [
	{ id: 1, name: 'setTimeout', stack: 'at work (foo.js:1:2)', destroyed: false },
	{ id: 2, name: 'setInterval', stack: 'at poll (bar.js:10:3)', destroyed: false },
]
async function agent(options: { timers?: unknown; registered?: string[]; updated?: number; success?: boolean } = {}) {
	const server = createServer((req, res) => {
		res.setHeader('content-type', 'application/json')
		res.end(
			JSON.stringify(
				req.url === '/info'
					? { name: 'mitojs-agent', protocol_version: 1, version: '0.1.0', status: 'running', pid: process.pid }
					: {
							success: options.success ?? true,
							data: { cpu: null, memory: null, errors: [], timers: options.timers ?? timers, last_updated: Date.now() },
							registered_subjects: options.registered ?? ['Timeout'],
							updated_at: { Timeout: options.updated ?? Date.now() },
							intervals: { Timeout: 1000 },
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
function context(agentClient?: AgentClient): DiagnosticContext {
	return {
		pid: 12345,
		port: 9229,
		json: true,
		agentClient,
		output: () => {},
		session: {
			evaluate: async () => {
				throw new Error('A text-only Inspector SDK hint is not timer evidence')
			},
		} as unknown as InspectorSession,
	}
}

describe('current timer snapshots', () => {
	it('returns actual active timer identities and creation stacks from the Agent', async () => {
		expect(await timersPlugin.execute(context(await agent()), {})).toEqual({
			success: true,
			data: { timers, source: 'agent' },
		})
	})
	it('accepts an observed empty snapshot as zero active timers', async () => {
		expect(await timersPlugin.execute(context(await agent({ timers: [] })), {})).toEqual({
			success: true,
			data: { timers: [], source: 'agent' },
		})
	})
	it('fails explicitly without SDK evidence', async () => {
		expect(await timersPlugin.execute(context(), {})).toMatchObject({ success: false, errorCode: 'SDK_REQUIRED' })
	})
	it('fails explicitly when the timer subject is not registered', async () => {
		expect(await timersPlugin.execute(context(await agent({ registered: ['Memory'] })), {})).toMatchObject({
			success: false,
			errorCode: 'SDK_REQUIRED',
		})
	})
	it('does not return stale timers as a current snapshot', async () => {
		expect(await timersPlugin.execute(context(await agent({ updated: Date.now() - 10000 })), {})).toMatchObject({
			success: false,
			errorCode: 'SDK_REQUIRED',
		})
	})
	it('fails when the Agent has no record of the target process', async () => {
		expect(await timersPlugin.execute(context(await agent({ success: false })), {})).toMatchObject({
			success: false,
			errorCode: 'SDK_REQUIRED',
		})
	})
	it('does not turn malformed timer payloads into a successful hint', async () => {
		expect(await timersPlugin.execute(context(await agent({ timers: 'not a snapshot' })), {})).toMatchObject({
			success: false,
			errorCode: 'SDK_REQUIRED',
		})
	})
})

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DiagnosticContext } from '../../core/types.js'
import { diagnosePlugin } from '../../plugins/diagnose.js'
import { AgentClient } from '../../services/agent-client.js'
import type { InspectorSession } from '../../services/inspector-session.js'

const directories: string[] = []
const servers: Server[] = []
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
function context(
	evaluate: () => Promise<unknown> = async () => {
		throw new Error('target unavailable')
	}
): DiagnosticContext {
	return { pid: 123, port: 9229, json: true, output: () => {}, session: { evaluate } as unknown as InspectorSession }
}
async function agent(changing: boolean, truncated = 0) {
	const beginning = Date.now()
	let reads = 0
	const server = createServer((_req, res) => {
		const final = changing && reads++ > 0
		res.setHeader('content-type', 'application/json')
		res.end(
			JSON.stringify({
				success: true,
				data: {
					cpu: null,
					memory: null,
					errors: [],
					timers: final
						? [
								{ id: 1, name: 'setInterval', stack: 'at poll (poll.js:10:1)' },
								{ id: 2, name: 'setInterval', stack: 'at poll (poll.js:10:1)' },
							]
						: [{ id: 1, name: 'setInterval', stack: 'at poll (poll.js:10:1)' }],
				},
				registered_subjects: ['Timeout'],
				updated_at: { Timeout: final ? beginning + 10 : beginning },
				intervals: { Timeout: 1000 },
				truncated: { errors: 0, timers: truncated },
			})
		)
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	servers.push(server)
	return new AgentClient((server.address() as { port: number }).port)
}

describe('composite diagnosis command', () => {
	// Replacing final snapshot with the first must lose this positive measured delta.
	it('measures inspector memory over a real observation window', async () => {
		let sample = 0
		const result = await diagnosePlugin.execute(
			context(async () =>
				sample++ === 0 ? { heapUsed: 100, heapTotal: 400, rss: 200 } : { heapUsed: 130, heapTotal: 400, rss: 220 }
			),
			{ scenario: 'memory', duration: '15' }
		)
		expect(result.success).toBe(true)
		expect(result.data.memory.heapUsed).toMatchObject({
			start: 100,
			end: 130,
			delta: 30,
			pattern: 'increasing',
			source: 'inspector',
		})
		expect(result.data.memory.heapUsed.durationMs).toBeGreaterThanOrEqual(10)
		expect(result.data.unavailable).toEqual([])
	})

	it('uses agent sample timestamps to measure timer growth and creation stacks', async () => {
		const ctx = context()
		ctx.agentClient = await agent(true)
		const result = await diagnosePlugin.execute(ctx, { scenario: 'timers', duration: '15' })
		expect(result.success).toBe(true)
		expect(result.data.timers.active).toMatchObject({
			start: 1,
			end: 2,
			delta: 1,
			durationMs: 10,
			ratePerSecond: 100,
			source: 'agent',
		})
		expect(result.data.timers.growingStacks[0]).toMatchObject({ stack: 'at poll (poll.js:10:1)', delta: 1 })
	})

	it('fails explicitly when two distinct timer samples were not collected', async () => {
		const ctx = context()
		ctx.agentClient = await agent(false)
		const result = await diagnosePlugin.execute(ctx, { scenario: 'timers', duration: '5' })
		expect(result).toMatchObject({ success: false, errorCode: 'INSUFFICIENT_EVIDENCE' })
		expect(result.data.unavailable[0].error).toContain('distinct')
		expect(result.data.timers).toBeUndefined()
	})

	it('does not claim precise timer growth from truncated snapshots', async () => {
		const ctx = context()
		ctx.agentClient = await agent(true, 5)
		const result = await diagnosePlugin.execute(ctx, { scenario: 'timers', duration: '5' })
		expect(result.success).toBe(false)
		expect(result.data.unavailable[0].error).toContain('truncated')
	})

	it('captures a profile artifact and attributes real CDP sample frames', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'mito-diagnose-profile-'))
		directories.push(dir)
		const profile = {
			startTime: 0,
			endTime: 1000,
			nodes: [
				{ id: 1, callFrame: { functionName: 'work', url: 'file:///app/work.js', lineNumber: 4, columnNumber: 0 } },
			],
			samples: [1],
			timeDeltas: [1000],
		}
		const ctx = context()
		ctx.session = {
			sendMessage: async (method: string) => (method === 'Profiler.stop' ? { profile } : {}),
		} as unknown as InspectorSession
		const result = await diagnosePlugin.execute(ctx, { scenario: 'cpu', duration: '5', dir })
		expect(result.success).toBe(true)
		expect(result.data.cpu.hotspots[0]).toMatchObject({ functionName: 'work', line: 5, selfTimeMs: 1 })
		expect(result.data.artifacts[0]).toContain(dir)
		expect(JSON.parse(await readFile(result.data.artifacts[0], 'utf8'))).toEqual(profile)
	})

	it('returns partial evidence with explicit unavailable components', async () => {
		let sample = 0
		const ctx = context(async () => ({ heapUsed: sample++ === 0 ? 100 : 120, heapTotal: 400, rss: 200 }))
		const session = ctx.session as InspectorSession
		session.sendMessage = async () => {
			throw new Error('CPU profiling blocked')
		}
		const result = await diagnosePlugin.execute(ctx, { scenario: 'all', duration: '5' })
		expect(result.success).toBe(true)
		expect(result.data.memory.heapUsed.delta).toBe(20)
		expect(result.data.unavailable.map((item: { kind: string }) => item.kind).sort()).toEqual(['cpu', 'timers'])
	})

	it('validates options before touching the target', async () => {
		expect(await diagnosePlugin.execute(context(), { scenario: 'unknown' })).toMatchObject({
			success: false,
			errorCode: 'INVALID_ARGUMENT',
		})
		for (const duration of ['0', '-1', 'abc', '2.5', 'Infinity'])
			expect(await diagnosePlugin.execute(context(), { duration })).toMatchObject({
				success: false,
				errorCode: 'INVALID_ARGUMENT',
			})
	})

	it('propagates cancellation and stops its observation wait promptly', async () => {
		const controller = new AbortController()
		const ctx = context(async () => ({ heapUsed: 1, rss: 2 }))
		ctx.signal = controller.signal
		const operation = diagnosePlugin.execute(ctx, { scenario: 'memory', duration: '10000' })
		setTimeout(() => controller.abort(), 5)
		await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
	})
})

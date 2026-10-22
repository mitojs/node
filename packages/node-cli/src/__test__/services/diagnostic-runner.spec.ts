import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { registry } from '../../core/registry'
import { executeDiagnostic } from '../../services/diagnostic-runner'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn()
})

async function settings() {
	const directory = await mkdtemp(path.join(tmpdir(), 'mito-runner-'))
	cleanup.push(() => rm(directory, { recursive: true, force: true }))
	return { pid: process.pid, agentPort: 19998, historyDir: directory }
}

describe('shared diagnostic execution contract', () => {
	it('reports plugin failures as structured failures without losing their code', async () => {
		registry.register({
			name: 'test-failure',
			description: 'test',
			execute: async () => ({ success: false, error: 'No timer evidence', errorCode: 'SDK_REQUIRED' }),
		})
		expect(await executeDiagnostic('test-failure', {}, await settings())).toMatchObject({
			success: false,
			command: 'test-failure',
			errorCode: 'SDK_REQUIRED',
		})
	})
	it('rejects non-positive PIDs before executing a target plugin', async () => {
		registry.register({ name: 'test-target', description: 'test', execute: async () => ({ success: true }) })
		expect(await executeDiagnostic('test-target', {}, { ...(await settings()), pid: -1 })).toMatchObject({
			success: false,
			errorCode: 'INVALID_ARGUMENT',
		})
	})
	it('bounds a plugin that never resolves', async () => {
		registry.register({ name: 'test-timeout', description: 'test', execute: async () => new Promise(() => {}) })
		const start = Date.now()
		expect(await executeDiagnostic('test-timeout', {}, { ...(await settings()), timeout: 30 })).toMatchObject({
			success: false,
			errorCode: 'TIMEOUT',
		})
		expect(Date.now() - start).toBeLessThan(500)
	})
	it('returns cancellation rather than a successful empty result', async () => {
		registry.register({ name: 'test-cancel', description: 'test', execute: async () => new Promise(() => {}) })
		const controller = new AbortController()
		const pending = executeDiagnostic('test-cancel', {}, { ...(await settings()), signal: controller.signal })
		controller.abort()
		expect(await pending).toMatchObject({ success: false, errorCode: 'CANCELLED' })
	})
	it('does not initialize Inspector when a fresh Agent sample satisfies a plugin', async () => {
		const server = http.createServer((req, res) => {
			res.setHeader('Content-Type', 'application/json')
			res.end(
				JSON.stringify(
					req.url === '/info'
						? { name: 'mitojs-agent', protocol_version: 1, status: 'running', pid: process.pid }
						: {
								success: true,
								data: { memory: { heapInfo: {}, heapSpaces: [], memory: { rss: 123, heapUsed: 12, heapTotal: 24 } } },
								registered_subjects: ['Memory'],
								updated_at: { Memory: Date.now() },
								intervals: { Memory: 5000 },
							}
				)
			)
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
		const { memoryPlugin } = await import('../../plugins/memory')
		registry.register(memoryPlugin)
		const result = await executeDiagnostic(
			'memory',
			{},
			{ ...(await settings()), port: 1, agentPort: (server.address() as { port: number }).port }
		)
		expect(result).toMatchObject({ success: true, data: { source: 'agent', memory: { rss: 123 } } })
	})
})

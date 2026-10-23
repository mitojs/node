import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MitoNode } from '../client'
import { JsErrorCollector } from '../collector/js-error'
import { TimeoutCollector } from '../collector/timeout'
import { configMap } from '../config'
import { requestToAgent } from '../request'
import { SubjectNames } from '../shared'
import { TimeoutSubject } from '../subjects/timeout'

// The OS child-process boundary is isolated; lifecycle, HTTP and collectors remain real.
vi.mock('../binary', () => ({ initAgent: async () => undefined }))
let server: Server | undefined
let client: MitoNode | undefined
async function serve(handler: Parameters<typeof createServer>[0]) {
	server = createServer(handler)
	await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
	const address = server.address() as { port: number }
	process.env.MITO_AGENT_TCP_PORT = String(address.port)
	configMap.update({ agentHost: '127.0.0.1', agentTCPPort: address.port })
}
afterEach(async () => {
	await client?.destroy()
	client = undefined
	if (server) {
		await new Promise<void>((resolve) => server!.close(() => resolve()))
		server = undefined
	}
	delete process.env.MITO_AGENT_TCP_PORT
	vi.useRealTimers()
})
describe('reliable SDK boundary', () => {
	it('propagates failed registration and allows retry after rollback', async () => {
		let fail = true
		await serve((_req, res) => {
			res.writeHead(fail ? 503 : 200, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ success: !fail }))
		})
		client = new MitoNode({ metrics: { CPU: false, Memory: false, JSError: false, Timeout: false } })
		await expect(client.start()).rejects.toThrow()
		expect((globalThis as any).__MITO_NODE_ACTIVE__).not.toBe(true)
		fail = false
		await expect(client.start()).resolves.toBeUndefined()
		expect((globalThis as any).__MITO_NODE_ACTIVE__).toBe(true)
	})
	it('rolls back a registration whose acknowledgement failed', async () => {
		let registered = false
		await serve((req, res) => {
			if (req.url === '/ipc/register_process') {
				registered = true
				res.writeHead(503)
			} else {
				registered = false
				res.writeHead(200)
			}
			res.end('{"success":true}')
		})
		client = new MitoNode({ metrics: { CPU: false, Memory: false, JSError: false, Timeout: false } })
		await expect(client.start()).rejects.toThrow('503')
		expect(registered).toBe(false)
	})
	it('destroys collectors, restores hooks and unregisters only itself', async () => {
		const requests: Array<{ url: string; body: any }> = []
		await serve((req, res) => {
			let body = ''
			req.on('data', (c) => {
				body += c
			})
			req.on('end', () => {
				requests.push({ url: req.url!, body: body ? JSON.parse(body) : null })
				res.writeHead(200, { 'content-type': 'application/json' })
				res.end('{"success":true}')
			})
		})
		const timeout = global.setTimeout
		const listeners = process.listenerCount('uncaughtExceptionMonitor')
		client = new MitoNode()
		await client.start()
		expect(global.setTimeout).not.toBe(timeout)
		await client.destroy()
		expect(global.setTimeout).toBe(timeout)
		expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(listeners)
		expect(requests.filter((r) => r.url === '/ipc/unregister_process').map((r) => r.body.pid)).toEqual([process.pid])
		await client.start()
		await client.destroy()
	})
	it('a second SDK instance cannot redirect or unregister the active instance', async () => {
		const routes: string[] = []
		await serve((req, res) => {
			routes.push(req.url!)
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end('{"success":true}')
		})
		client = new MitoNode({ metrics: { CPU: false, Memory: false, JSError: false, Timeout: false } })
		await client.start()
		process.env.MITO_AGENT_TCP_PORT = '1'
		const other = new MitoNode()
		await expect(other.start()).rejects.toThrow('initialized')
		await other.destroy()
		expect((globalThis as any).__MITO_NODE_ACTIVE__).toBe(true)
		await client.destroy()
		expect(routes).toContain('/ipc/unregister_process')
	})
	it('treats a non-success HTTP response as an error', async () => {
		await serve((_req, res) => {
			res.writeHead(404, { 'content-type': 'application/json' })
			res.end('{"success":false}')
		})
		await expect(requestToAgent('/metrics/push', { method: 'POST' })).rejects.toThrow('404')
	})
	it('reports one rejected startup to concurrent callers', async () => {
		await serve((_req, res) => {
			res.writeHead(400, { 'content-type': 'application/json' })
			res.end('{"success":false}')
		})
		client = new MitoNode({ metrics: { CPU: false, Memory: false, JSError: false, Timeout: false } })
		const results = await Promise.allSettled([client.start(), client.start()])
		expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
	})
})
describe('collector ownership', () => {
	it('observes fatal exceptions without installing an exception handler', () => {
		const before = process.listenerCount('uncaughtException')
		const collector = new JsErrorCollector()
		try {
			expect(process.listenerCount('uncaughtException')).toBe(before)
		} finally {
			collector.destroy()
		}
	})
	it('removes canceled timers from the active snapshot', () => {
		const collector = new TimeoutCollector()
		const timer = setTimeout(() => {}, 60000)
		clearTimeout(timer)
		try {
			expect(collector.get().size).toBe(0)
		} finally {
			collector.destroy()
		}
	})
	it('emits an empty timer snapshot and restores hooks when unsubscribed', () => {
		vi.useFakeTimers()
		const original = setTimeout
		const subject = new TimeoutSubject({ interval: 10 })
		const snapshots: any[] = []
		const subscription = subject.subscribe((data) => snapshots.push(data))
		subject.start()
		vi.advanceTimersByTime(10)
		subscription.unsubscribe()
		expect(snapshots).toEqual([[]])
		expect(setTimeout).toBe(original)
		expect(subject.getCollector()).toBeNull()
	})
})

it('bounds active timer tracking and discards completed one-shot timers', async () => {
	const collector = new TimeoutCollector()
	const timers = Array.from({ length: 1005 }, () => setTimeout(() => {}, 60000))
	try {
		expect(collector.get().size).toBe(1000)
	} finally {
		timers.forEach(clearTimeout)
		collector.destroy()
	}
})

it('enforces a total HTTP deadline even while the server keeps sending bytes', async () => {
	await serve((_req, res) => {
		res.writeHead(200, { 'content-type': 'application/json' })
		res.write(' ')
		const timer = setInterval(() => res.write(' '), 5)
		const ending = setTimeout(() => {
			clearInterval(timer)
			res.end('{"success":true}')
		}, 150)
		res.on('close', () => {
			clearInterval(timer)
			clearTimeout(ending)
		})
	})
	await expect(requestToAgent('/slow', { timeout: 20 })).rejects.toThrow(/timeout/i)
})

it('does not format stacks for timers canceled before any diagnostic consumes them', () => {
	const descriptor = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace')
	let handler = Error.prepareStackTrace
	let assignments = 0
	const collector = new TimeoutCollector()
	Object.defineProperty(Error, 'prepareStackTrace', {
		configurable: true,
		get: () => handler,
		set: (value) => {
			assignments++
			handler = value
		},
	})
	try {
		const timer = setTimeout(() => {}, 60000)
		clearTimeout(timer)
		expect(collector.get().size).toBe(0)
		expect(assignments).toBe(0)
	} finally {
		collector.destroy()
		if (descriptor) Object.defineProperty(Error, 'prepareStackTrace', descriptor)
		else delete Error.prepareStackTrace
	}
})

it('captures only the wrapper and creation caller needed for timer location evidence', () => {
	const capture = Error.captureStackTrace
	let depth: number | undefined
	Error.captureStackTrace = (target, skip) => {
		depth = Error.stackTraceLimit
		capture(target, skip)
	}
	const collector = new TimeoutCollector()
	const timer = setTimeout(() => {}, 60000)
	try {
		expect(depth).toBeLessThanOrEqual(2)
		expect([...collector.get().values()][0].stack).toContain('reliability.spec.ts')
	} finally {
		clearTimeout(timer)
		collector.destroy()
		Error.captureStackTrace = capture
	}
})

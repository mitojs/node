import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { InspectorSession } from '../../services/inspector-session'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
	vi.restoreAllMocks()
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function inspector(options: { split?: boolean; pid?: number; disconnect?: boolean } = {}) {
	const server = http.createServer((_req, res) => {
		const body = JSON.stringify([{ id: 'test', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/test` }])
		if (options.split) {
			res.write(body.slice(0, 30))
			setTimeout(() => res.end(body.slice(30)), 5)
		} else res.end(body)
	})
	const sockets = new WebSocketServer({ server })
	sockets.on('connection', (socket) =>
		socket.on('message', (raw) => {
			const request = JSON.parse(raw.toString())
			if (request.method === 'Runtime.evaluate' && request.params.expression === 'process.pid') {
				socket.send(JSON.stringify({ id: request.id, result: { result: { value: options.pid ?? process.pid } } }))
			} else if (options.disconnect) socket.close()
		})
	)
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = (server.address() as { port: number }).port
	cleanups.push(async () => {
		for (const socket of sockets.clients) socket.terminate()
		await new Promise<void>((resolve) => sockets.close(() => server.close(() => resolve())))
	})
	return port
}

async function resultWithin(promise: Promise<unknown>) {
	return Promise.race([
		promise.then(
			() => 'resolved',
			(error: Error) => error.message
		),
		new Promise<string>((resolve) => setTimeout(() => resolve('still pending'), 100)),
	])
}

describe('Inspector session resource ownership', () => {
	async function tricklingDiscovery() {
		const server = http.createServer((_req, response) => {
			response.write('[')
			const timer = setInterval(() => response.write(' '), 5)
			response.once('close', () => clearInterval(timer))
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		cleanups.push(async () => {
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		})
		return (server.address() as { port: number }).port
	}
	it('bounds discovery even if an endpoint continually trickles incomplete JSON', async () => {
		const session = new InspectorSession({ timeout: 20 })
		expect(await resultWithin(session.connect(await tricklingDiscovery()))).toMatch(/timeout|timed out/i)
	})
	it('never signals the target after discovery has been cancelled', async () => {
		const controller = new AbortController()
		const session = new InspectorSession({ signal: controller.signal })
		const kill = vi.spyOn(process, 'kill')
		const pending = session.open(process.pid, await tricklingDiscovery())
		controller.abort(new DOMException('cancelled discovery', 'AbortError'))
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
		expect(kill).not.toHaveBeenCalled()
		session.close()
	})
	it('assembles discovery response chunks in wire order', async () => {
		const port = await inspector({ split: true })
		const session = new InspectorSession()
		cleanups.push(async () => {
			session.close()
		})
		await expect(session.connect(port)).resolves.toBeUndefined()
	})
	it('rejects an outstanding command when its socket disconnects', async () => {
		const port = await inspector({ disconnect: true })
		const session = new InspectorSession()
		cleanups.push(async () => {
			session.close()
		})
		await session.connect(port)
		expect(await resultWithin(session.sendMessage('Profiler.enable'))).toMatch(/disconnect|closed/i)
	})
	it('bounds a command whose peer never answers', async () => {
		const port = await inspector()
		const session = new InspectorSession({ timeout: 20 })
		cleanups.push(async () => {
			session.close()
		})
		await session.connect(port)
		expect(await resultWithin(session.sendMessage('Profiler.enable'))).toMatch(/timeout|timed out/i)
	})
	it('rejects an Inspector belonging to a different PID before diagnostic execution', async () => {
		const port = await inspector({ pid: process.pid + 1 })
		const session = new InspectorSession()
		cleanups.push(async () => {
			session.close()
		})
		await session.open(process.pid, port)
		await expect(session.connect(port)).rejects.toThrow(/PID|process.*match/i)
	})
})

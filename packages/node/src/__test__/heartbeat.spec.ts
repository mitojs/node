import { createServer, type Server } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { MitoNode } from '../client'

const recovery = vi.hoisted(() => ({ gate: null as Promise<void> | null, entered: false }))
vi.mock('../binary', () => ({
	initAgent: async () => {
		if (recovery.gate) {
			recovery.entered = true
			await recovery.gate
		}
	},
}))
// The virtual clock replaces only the OS timer; HTTP registration and recovery are real.
vi.mock('node:timers', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:timers')>()),
	setInterval: (...args: any[]) => (global.setInterval as any)(...args),
	clearInterval: (timer: any) => global.clearInterval(timer),
}))
let client: MitoNode | undefined
let server: Server | undefined
afterEach(async () => {
	await client?.destroy()
	if (server) await new Promise<void>((r) => server!.close(() => r()))
	vi.useRealTimers()
	delete process.env.MITO_AGENT_TCP_PORT
	recovery.gate = null
	recovery.entered = false
})
it('sends a heartbeat after thirty seconds and restores a lost registration', async () => {
	const routes: string[] = []
	server = createServer((req, res) => {
		routes.push(req.url!)
		res.writeHead(req.url === '/heartbeat' ? 404 : 200, { 'content-type': 'application/json' })
		res.end(JSON.stringify({ success: req.url !== '/heartbeat' }))
	})
	await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
	process.env.MITO_AGENT_TCP_PORT = String((server.address() as any).port)
	vi.useFakeTimers()
	client = new MitoNode({ metrics: { CPU: false, Memory: false, JSError: false, Timeout: false } })
	await client.start()
	await vi.advanceTimersByTimeAsync(29999)
	expect(routes).toEqual(['/ipc/register_process'])
	await vi.advanceTimersByTimeAsync(1)
	for (let n = 0; n < 100 && routes.filter((r) => r === '/ipc/register_process').length < 2; n++) await delay(2)
	expect(routes).toEqual(['/ipc/register_process', '/heartbeat', '/ipc/register_process'])
	await client.destroy()
	await vi.advanceTimersByTimeAsync(60000)
	expect(routes.filter((r) => r === '/heartbeat')).toHaveLength(1)
})

it('does not resurrect registration when destroyed during Agent recovery', async () => {
	const routes: string[] = []
	server = createServer((req, res) => {
		routes.push(req.url!)
		res.writeHead(req.url === '/heartbeat' ? 404 : 200, { 'content-type': 'application/json' })
		res.end(JSON.stringify({ success: req.url !== '/heartbeat' }))
	})
	await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
	process.env.MITO_AGENT_TCP_PORT = String((server.address() as any).port)
	vi.useFakeTimers()
	client = new MitoNode({ metrics: { CPU: false, Memory: false, JSError: false, Timeout: false } })
	await client.start()
	let finishRecovery!: () => void
	recovery.gate = new Promise<void>((r) => {
		finishRecovery = r
	})
	await vi.advanceTimersByTimeAsync(30000)
	for (let n = 0; n < 100 && !recovery.entered; n++) await delay(2)
	await client.destroy()
	finishRecovery()
	await delay(5)
	expect(routes.filter((route) => route === '/ipc/register_process')).toHaveLength(1)
})

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { InspectorSession } from '../../services/inspector-session'

it('closes an Inspector it activated even when cancellation precedes WebSocket connection', async () => {
	const server = net.createServer()
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = (server.address() as net.AddressInfo).port
	await new Promise<void>((resolve) => server.close(() => resolve()))
	const target = spawn(
		process.execPath,
		[
			`--inspect-port=127.0.0.1:${port}`,
			'-e',
			`
		process.on('message', () => process.send({url:require('node:inspector').url() || null}));
		process.send({ready:true}); setInterval(()=>{},1000);
	`,
		],
		{ stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
	)
	const controller = new AbortController()
	const session = new InspectorSession({ timeout: 1000, signal: controller.signal })
	try {
		await once(target, 'message')
		let stderr = ''
		target.stderr!.on('data', (chunk) => {
			stderr += chunk
			if (stderr.includes('Debugger listening')) controller.abort(new DOMException('early cancellation', 'AbortError'))
		})
		await session.open(target.pid!, port).catch(() => {})
		expect(controller.signal.aborted).toBe(true)
		await session.dispose()
		const probe = once(target, 'message')
		target.send('probe')
		expect((await probe)[0]).toEqual({ url: null })
	} finally {
		session.close()
		target.kill('SIGTERM')
		if (target.exitCode === null && target.signalCode === null) await once(target, 'exit')
	}
}, 10000)

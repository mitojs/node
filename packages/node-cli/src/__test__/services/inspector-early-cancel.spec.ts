import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { expect, it } from 'vitest'
import { InspectorSession } from '../../services/inspector-session'

// SIGUSR1 激活仅适用于 Unix；Windows 使用下方预先开启的 Inspector 路径验证取消。
it.skipIf(process.platform === 'win32')(
	'closes an Inspector it activated even when cancellation precedes WebSocket connection',
	async () => {
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
				if (stderr.includes('Debugger listening'))
					controller.abort(new DOMException('early cancellation', 'AbortError'))
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
	},
	10000
)

it('preserves a preopened Inspector when cancellation precedes WebSocket connection', async () => {
	const target = spawn(
		process.execPath,
		[
			'--inspect=127.0.0.1:0',
			'-e',
			`
		process.on('message', () => process.send({url:require('node:inspector').url()}));
		process.send({url:require('node:inspector').url()}); setInterval(()=>{},1000);
	`,
		],
		{ stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
	)
	const controller = new AbortController()
	const session = new InspectorSession({ timeout: 1000, signal: controller.signal })
	try {
		const { url } = (await once(target, 'message'))[0] as { url: string }
		const port = Number(new URL(url).port)
		if (!target.pid) throw new Error('Fixture process did not start')
		await session.open(target.pid, port)
		controller.abort(new DOMException('early cancellation', 'AbortError'))
		await expect(session.connect(port)).rejects.toMatchObject({ name: 'AbortError' })
		await session.dispose()
		const probe = once(target, 'message')
		target.send('probe')
		expect((await probe)[0]).toEqual({ url })
	} finally {
		session.close()
		target.kill('SIGTERM')
		if (target.exitCode === null && target.signalCode === null) await once(target, 'exit')
	}
}, 10000)

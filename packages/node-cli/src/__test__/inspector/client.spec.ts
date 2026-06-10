import { EventEmitter } from 'node:events'
import { InspectorClient } from '../../inspector/client.js'

class FakeSocket extends EventEmitter {
	sent: string[] = []
	readyState = 1

	send(message: string) {
		this.sent.push(message)
	}

	close() {}
}

describe('InspectorClient', () => {
	it('matches inspector responses by id', async () => {
		const socket = new FakeSocket()
		const client = new InspectorClient(socket as any)

		const pending = client.send('Runtime.evaluate', { expression: '1 + 1' })
		const request = JSON.parse(socket.sent[0])

		socket.emit('message', Buffer.from(JSON.stringify({ id: request.id, result: { result: { value: 2 } } })))

		await expect(pending).resolves.toEqual({ result: { value: 2 } })
	})

	it('rejects inspector error responses by id', async () => {
		const socket = new FakeSocket()
		const client = new InspectorClient(socket as any)

		const pending = client.send('Runtime.evaluate', { expression: 'bad' })
		const request = JSON.parse(socket.sent[0])

		socket.emit(
			'message',
			Buffer.from(JSON.stringify({ id: request.id, error: { code: -32000, message: 'bad eval' } }))
		)

		await expect(pending).rejects.toThrow('bad eval')
	})

	it('evaluates expressions and returns the remote value', async () => {
		const socket = new FakeSocket()
		const client = new InspectorClient(socket as any)

		const pending = client.evaluate('process.pid')
		const request = JSON.parse(socket.sent[0])

		expect(request.method).toBe('Runtime.evaluate')
		expect(request.params.expression).toBe('process.pid')
		expect(request.params.returnByValue).toBe(true)

		socket.emit('message', Buffer.from(JSON.stringify({ id: request.id, result: { result: { value: 12345 } } })))

		await expect(pending).resolves.toBe(12345)
	})
})

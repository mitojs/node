import { configMap } from '../../config'
import { SyncToAgent } from '../../init'

describe('SyncToAgent', () => {
	beforeEach(() => {
		configMap.set({
			agentHost: '127.0.0.1',
			agentTCPPort: 16676,
			pid: 12345,
			dir: '',
		})
	})

	afterEach(() => {
		configMap.destroy()
	})

	it('registers the current process and local proxy port with the agent', async () => {
		const registerProcessToAgent = jest.fn().mockResolvedValue({ success: true, message: 'ok' })

		await SyncToAgent({ registerProcessToAgent })

		expect(registerProcessToAgent).toHaveBeenCalledWith({
			process_id: 12345,
			proxy_port: 16667,
		})
	})

	it('registers the actual proxy port when the worker used a fallback port', async () => {
		const registerProcessToAgent = jest.fn().mockResolvedValue({ success: true, message: 'ok' })

		await SyncToAgent({ registerProcessToAgent, proxyPort: 16668 })

		expect(registerProcessToAgent).toHaveBeenCalledWith({
			process_id: 12345,
			proxy_port: 16668,
		})
	})
})

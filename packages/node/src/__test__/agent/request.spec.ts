import { configMap } from '../../config'
import { recordMetricToAgent, registerProcessToAgent } from '../../request'

describe('agent request helpers', () => {
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

	it('registers the current process with the agent HTTP contract', async () => {
		const easyFetch = jest.fn().mockResolvedValue({
			json: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
		})
		const retry = jest.fn(async (fn) => fn())

		await registerProcessToAgent(
			{ process_id: 12345, proxy_port: 16667 },
			{
				easyFetch,
				retry,
			}
		)

		expect(easyFetch).toHaveBeenCalledWith('http://127.0.0.1:16676/processes/register', {
			method: 'POST',
			body: JSON.stringify({ process_id: 12345, proxy_port: 16667 }),
		})
	})

	it('records metrics with the agent HTTP contract', async () => {
		const easyFetch = jest.fn().mockResolvedValue({
			json: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
		})
		const retry = jest.fn(async (fn) => fn())

		await recordMetricToAgent(
			{ process_id: 12345, metric_type: 'memory', data: { rss: 100 } },
			{
				easyFetch,
				retry,
			}
		)

		expect(easyFetch).toHaveBeenCalledWith('http://127.0.0.1:16676/metrics', {
			method: 'POST',
			body: JSON.stringify({ process_id: 12345, metric_type: 'memory', data: { rss: 100 } }),
		})
	})
})

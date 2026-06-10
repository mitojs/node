import { normalizeMetricData, sendMetricToAgent, toAgentMetricType } from '../../agent'
import { configMap } from '../../config'
import { SubjectNames } from '../../shared'

describe('agent metric sender', () => {
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

	it('maps supported subject names to agent metric types', () => {
		expect(toAgentMetricType(SubjectNames.CPU)).toBe('cpu')
		expect(toAgentMetricType(SubjectNames.Memory)).toBe('memory')
		expect(toAgentMetricType(SubjectNames.JSError)).toBe('js_error')
		expect(toAgentMetricType(SubjectNames.Timeout)).toBe('timeout')
	})

	it('sends supported subject data to the agent with the current process id', async () => {
		const recordMetricToAgent = jest.fn().mockResolvedValue({ success: true, message: 'ok' })

		await expect(
			sendMetricToAgent(SubjectNames.Memory, { memory: { rss: 100 } }, { recordMetricToAgent })
		).resolves.toEqual({
			sent: true,
		})

		expect(recordMetricToAgent).toHaveBeenCalledWith({
			process_id: 12345,
			metric_type: 'memory',
			data: { memory: { rss: 100 } },
		})
	})

	it('serializes errors into agent-safe payloads', () => {
		const error = new TypeError('boom')
		error.stack = 'TypeError: boom\n    at app.js:1:1'

		expect(normalizeMetricData(error)).toEqual({
			name: 'TypeError',
			message: 'boom',
			stack: 'TypeError: boom\n    at app.js:1:1',
		})
	})

	it('serializes timeout maps into agent-safe payloads', () => {
		const timer = { _destroyed: false }
		const timeoutMap = new Map([
			[
				1,
				{
					name: 'setTimeout',
					stack: '/repo/app.js:10:1',
					timer,
				},
			],
		])

		expect(normalizeMetricData(timeoutMap)).toEqual([
			{
				id: 1,
				name: 'setTimeout',
				stack: '/repo/app.js:10:1',
				destroyed: false,
			},
		])
	})

	it('sends JS errors to the agent with a serializable payload', async () => {
		const recordMetricToAgent = jest.fn().mockResolvedValue({ success: true, message: 'ok' })
		const error = new Error('boom')
		error.stack = 'Error: boom\n    at app.js:1:1'

		await expect(sendMetricToAgent(SubjectNames.JSError, error, { recordMetricToAgent })).resolves.toEqual({
			sent: true,
		})

		expect(recordMetricToAgent).toHaveBeenCalledWith({
			process_id: 12345,
			metric_type: 'js_error',
			data: {
				name: 'Error',
				message: 'boom',
				stack: 'Error: boom\n    at app.js:1:1',
			},
		})
	})
})

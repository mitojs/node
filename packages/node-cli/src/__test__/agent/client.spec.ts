import { getAgentInfo, listAgentProcesses } from '../../agent/client.js'

describe('agent client', () => {
	it('requests agent info from the configured host and port', async () => {
		const requestJson = jest.fn().mockResolvedValue({
			name: 'mitojs-agent',
			version: '0.1.0',
			status: 'running',
		})

		await expect(getAgentInfo({ host: '127.0.0.1', port: 16676, timeout: 1500 }, { requestJson })).resolves.toEqual({
			name: 'mitojs-agent',
			version: '0.1.0',
			status: 'running',
		})
		expect(requestJson).toHaveBeenCalledWith('http://127.0.0.1:16676/info', 1500)
	})

	it('requests process snapshots from the local agent', async () => {
		const requestJson = jest.fn().mockResolvedValue([
			{
				process_id: 12345,
				proxy_port: 16667,
				latest_heartbeat_time: 100,
				latest_metrics: [
					{
						metric_type: 'memory',
						data: { rss: 100 },
						recorded_at: 100,
					},
				],
			},
		])

		await expect(
			listAgentProcesses({ host: 'localhost', port: 16666, timeout: 1000 }, { requestJson })
		).resolves.toEqual([
			{
				process_id: 12345,
				proxy_port: 16667,
				latest_heartbeat_time: 100,
				latest_metrics: [
					{
						metric_type: 'memory',
						data: { rss: 100 },
						recorded_at: 100,
					},
				],
			},
		])
		expect(requestJson).toHaveBeenCalledWith('http://localhost:16666/processes', 1000)
	})

	it('accepts legacy uds_port responses from older agents', async () => {
		const requestJson = jest.fn().mockResolvedValue([
			{
				process_id: 12345,
				uds_port: 16667,
				latest_heartbeat_time: 100,
				latest_metrics: [],
			},
		])

		await expect(
			listAgentProcesses({ host: 'localhost', port: 16666, timeout: 1000 }, { requestJson })
		).resolves.toEqual([
			{
				process_id: 12345,
				proxy_port: 16667,
				latest_heartbeat_time: 100,
				latest_metrics: [],
			},
		])
	})
})

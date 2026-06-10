import { runAgentMetrics, runAgentProcesses, runAgentStatus } from '../../agent/agent.js'

describe('agent commands', () => {
	it('returns status with agent info and registered processes', async () => {
		const deps = {
			getAgentInfo: jest.fn().mockResolvedValue({
				name: 'mitojs-agent',
				version: '0.1.0',
				status: 'running',
			}),
			listAgentProcesses: jest.fn().mockResolvedValue([
				{
					process_id: 12345,
					proxy_port: 16667,
					latest_heartbeat_time: 100,
					latest_metrics: [],
				},
			]),
		}

		await expect(runAgentStatus({ host: 'localhost', port: 16666, timeout: 1000 }, deps)).resolves.toEqual({
			agent: {
				name: 'mitojs-agent',
				version: '0.1.0',
				status: 'running',
			},
			processes: [
				{
					process_id: 12345,
					proxy_port: 16667,
					latest_heartbeat_time: 100,
					latest_metrics: [],
				},
			],
		})
	})

	it('returns process snapshots', async () => {
		const processes = [
			{
				process_id: 12345,
				proxy_port: 16667,
				latest_heartbeat_time: 100,
				latest_metrics: [],
			},
		]

		await expect(
			runAgentProcesses(
				{ host: 'localhost', port: 16666, timeout: 1000 },
				{
					getAgentInfo: jest.fn(),
					listAgentProcesses: jest.fn().mockResolvedValue(processes),
				}
			)
		).resolves.toEqual(processes)
	})

	it('returns metrics for a matching process id', async () => {
		await expect(
			runAgentMetrics(
				{ host: 'localhost', port: 16666, timeout: 1000, pid: 12345 },
				{
					getAgentInfo: jest.fn(),
					listAgentProcesses: jest.fn().mockResolvedValue([
						{
							process_id: 12345,
							proxy_port: 16667,
							latest_heartbeat_time: 100,
							latest_metrics: [{ metric_type: 'memory', data: { rss: 100 }, recorded_at: 100 }],
						},
					]),
				}
			)
		).resolves.toEqual({
			status: 'success',
			pid: 12345,
			metrics: [{ metric_type: 'memory', data: { rss: 100 }, recorded_at: 100 }],
		})
	})

	it('returns a not_found result when a process has no agent snapshot', async () => {
		await expect(
			runAgentMetrics(
				{ host: 'localhost', port: 16666, timeout: 1000, pid: 999 },
				{
					getAgentInfo: jest.fn(),
					listAgentProcesses: jest.fn().mockResolvedValue([]),
				}
			)
		).resolves.toEqual({
			status: 'not_found',
			pid: 999,
			metrics: [],
		})
	})
})

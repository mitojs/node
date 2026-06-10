import { formatAgentMetrics, formatAgentProcesses, formatAgentStatus } from '../../agent/format.js'
import type { AgentMetricsResult, AgentStatusResult } from '../../agent/types.js'

describe('agent output formatting', () => {
	it('formats agent status for humans', () => {
		const result: AgentStatusResult = {
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
		}

		expect(formatAgentStatus(result)).toContain('mitojs-agent')
		expect(formatAgentStatus(result)).toContain('Processes: 1')
	})

	it('formats registered process snapshots', () => {
		expect(
			formatAgentProcesses([
				{
					process_id: 12345,
					proxy_port: 16667,
					latest_heartbeat_time: 100,
					latest_metrics: [{ metric_type: 'memory', data: { rss: 100 }, recorded_at: 100 }],
				},
			])
		).toContain('12345')
		expect(formatAgentProcesses([])).toBe('No processes registered in mitojs-agent')
	})

	it('formats latest metrics for a process', () => {
		const result: AgentMetricsResult = {
			status: 'success',
			pid: 12345,
			metrics: [{ metric_type: 'memory', data: { rss: 100 }, recorded_at: 100 }],
		}

		expect(formatAgentMetrics(result)).toContain('memory')
		expect(formatAgentMetrics({ status: 'not_found', pid: 999, metrics: [] })).toBe('No metrics found for process 999')
	})
})

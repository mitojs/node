import { toAgentMetricsOptions, toAgentOptions } from '../../agent/command.js'

describe('agent command options', () => {
	it('uses the local agent defaults when connection options are omitted', () => {
		expect(toAgentOptions({})).toEqual({
			host: 'localhost',
			port: 16666,
			timeout: 1000,
		})
	})

	it('converts commander string options to agent client options', () => {
		expect(toAgentOptions({ host: '127.0.0.1', port: '16676', timeout: '1500' })).toEqual({
			host: '127.0.0.1',
			port: 16676,
			timeout: 1500,
		})
	})

	it('requires a numeric pid for metrics queries', () => {
		expect(toAgentMetricsOptions({ pid: '12345', port: '16676' })).toEqual({
			host: 'localhost',
			port: 16676,
			timeout: 1000,
			pid: 12345,
		})
	})
})

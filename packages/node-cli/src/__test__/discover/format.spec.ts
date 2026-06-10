import { formatDiscoverTable } from '../../discover/format.js'

describe('formatDiscoverTable', () => {
	it('formats a readable process table', () => {
		expect(
			formatDiscoverTable([
				{
					pid: 123,
					ppid: 10,
					startTime: '09:01:02',
					cpuTime: '0:01.20',
					command: 'node app.js',
					inspector: {
						enabled: true,
						port: 9229,
					},
				},
			])
		).toContain('PID')
		expect(formatDiscoverTable([])).toBe('No Node.js processes found')
	})
})

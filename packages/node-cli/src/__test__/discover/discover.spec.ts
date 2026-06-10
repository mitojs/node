import { discoverNodeProcesses, parseLsofListenOutput, parsePsOutput } from '../../discover/discover.js'

describe('parsePsOutput', () => {
	it('parses ps output into stable process records', () => {
		const output = `  PID  PPID STARTED      TIME COMMAND
  123    10 09:01:02   0:01.20 node demos/listen_server.mjs
  456    10 09:02:03   0:00.30 /usr/local/bin/node --inspect=9230 server.js
`

		expect(parsePsOutput(output)).toEqual([
			{
				pid: 123,
				ppid: 10,
				startTime: '09:01:02',
				cpuTime: '0:01.20',
				command: 'node demos/listen_server.mjs',
			},
			{
				pid: 456,
				ppid: 10,
				startTime: '09:02:03',
				cpuTime: '0:00.30',
				command: '/usr/local/bin/node --inspect=9230 server.js',
			},
		])
	})
})

describe('discoverNodeProcesses', () => {
	it('excludes the current mito-node process by default and enriches inspector state', async () => {
		const processes = await discoverNodeProcesses(
			{ includeSelf: false },
			{
				currentPid: 999,
				getPsOutput: jest.fn().mockResolvedValue(`  PID  PPID STARTED      TIME COMMAND
  111    10 09:01:02   0:01.20 node app.js
  999    10 09:01:03   0:00.01 node /repo/dist/cli.mjs discover --json
`),
				getListeningTcpPorts: jest.fn().mockResolvedValue([{ pid: 111, port: 9229 }]),
				isInspectorPort: jest.fn(async (_pid, port) => port === 9229),
			}
		)

		expect(processes).toEqual([
			{
				pid: 111,
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
	})

	it('uses lsof-backed listening ports when the command line does not include --inspect', async () => {
		const processes = await discoverNodeProcesses(
			{ includeSelf: false },
			{
				currentPid: 999,
				getPsOutput: jest.fn().mockResolvedValue(`  PID  PPID STARTED      TIME COMMAND
  111    10 09:01:02   0:01.20 node app.js
`),
				getListeningTcpPorts: jest.fn().mockResolvedValue([{ pid: 111, port: 9333 }]),
				isInspectorPort: jest.fn(async (_pid, port) => port === 9333),
			}
		)

		expect(processes[0].inspector).toEqual({
			enabled: true,
			port: 9333,
		})
	})
})

describe('parseLsofListenOutput', () => {
	it('parses lsof field output into pid and listening port pairs', () => {
		const output = `p111
n127.0.0.1:9229
p222
n*:3000
`

		expect(parseLsofListenOutput(output)).toEqual([
			{ pid: 111, port: 9229 },
			{ pid: 222, port: 3000 },
		])
	})
})

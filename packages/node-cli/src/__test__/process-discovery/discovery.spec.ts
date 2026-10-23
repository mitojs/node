import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { getNodeProcesses } from '../../shared/command.js'

const unixTable =
	'  101  1 Thu Oct 22 10:11:12 2026 0:01.23 /usr/local/bin/node /app/支付服务.js --label="a, b"\n 202 101 Thu Oct 22 10:22:33 2026 03:02.50 /opt/node/bin/node --eval "setInterval(() => {}, 1000)"\n'
const commandFailure = (status: number | null, stderr = '', code?: string, stdout = '') =>
	Object.assign(new Error('execution failed'), {
		status,
		stderr: Buffer.from(stderr),
		stdout: Buffer.from(stdout),
		code,
	})
const children: ReturnType<typeof spawn>[] = []
afterEach(async () => {
	for (const child of children.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) {
			const exited = once(child, 'exit')
			child.kill('SIGTERM')
			await exited
		}
	}
})

describe('Unix process discovery', () => {
	it('parses explicitly requested process fields while preserving the complete command and its spaces/commas', () => {
		const calls: Array<{ file: string; args: string[] }> = []
		const processes = getNodeProcesses({
			platform: 'darwin',
			run: (file, args) => {
				calls.push({ file, args })
				if (file === 'pgrep') return '101\n202\n'
				if (file === 'ps') return unixTable
				throw new Error('unexpected executable')
			},
		})
		expect(processes).toEqual([
			{
				pid: 101,
				ppid: 1,
				stime: 'Thu Oct 22 10:11:12 2026',
				time: '0:01.23',
				command: '/usr/local/bin/node /app/支付服务.js --label="a, b"',
			},
			{
				pid: 202,
				ppid: 101,
				stime: 'Thu Oct 22 10:22:33 2026',
				time: '03:02.50',
				command: '/opt/node/bin/node --eval "setInterval(() => {}, 1000)"',
			},
		])
		expect(calls[1]).toEqual({ file: 'ps', args: ['-ww', '-p', '101,202', '-o', 'pid=,ppid=,lstart=,time=,args='] })
	})
	it('returns an empty list only for the documented pgrep no-match result', () => {
		expect(
			getNodeProcesses({
				platform: 'linux',
				run: () => {
					throw commandFailure(1)
				},
			})
		).toEqual([])
	})
	it('exposes denied access rather than telling the user no processes exist', () => {
		expect(() =>
			getNodeProcesses({
				platform: 'linux',
				run: () => {
					throw commandFailure(1, 'pgrep: permission denied')
				},
			})
		).toThrow('permission denied')
	})
	it('reports a missing process-list utility and command timeouts as actionable failures', () => {
		expect(() =>
			getNodeProcesses({
				platform: 'linux',
				run: () => {
					throw commandFailure(null, '', 'ENOENT')
				},
			})
		).toThrow('pgrep')
		expect(() =>
			getNodeProcesses({
				platform: 'linux',
				run: () => {
					throw commandFailure(null, '', 'ETIMEDOUT')
				},
			})
		).toThrow('ETIMEDOUT')
	})
	it('does not pass malformed PID output into the ps argument vector', () => {
		expect(() =>
			getNodeProcesses({ platform: 'linux', run: (file) => (file === 'pgrep' ? '101\n202; echo injected' : unixTable) })
		).toThrow('PID')
	})
	it('accepts a process that exits between enumeration and the detail query without hiding genuine ps failures', () => {
		expect(
			getNodeProcesses({
				platform: 'linux',
				run: (file) => {
					if (file === 'pgrep') return '101'
					throw commandFailure(1)
				},
			})
		).toEqual([])
		expect(() =>
			getNodeProcesses({
				platform: 'linux',
				run: (file) => {
					if (file === 'pgrep') return '101'
					throw commandFailure(1, 'ps: access denied')
				},
			})
		).toThrow('access denied')
	})
	it('rejects a malformed detail table instead of silently discarding every discovered process', () => {
		expect(() =>
			getNodeProcesses({
				platform: 'darwin',
				run: (file) => (file === 'pgrep' ? '101' : 'PID PPID COMMAND\n101 ??? broken'),
			})
		).toThrow('ps')
	})
})

describe('Windows process discovery', () => {
	it('reads CIM JSON so quoted commas, backslashes and parent IDs survive intact', () => {
		const command = '"C:\\Program Files\\nodejs\\node.exe" "C:\\app\\支付.js" --label="a,b"'
		const result = getNodeProcesses({
			platform: 'win32',
			run: (_file, args) => {
				expect(args.join(' ')).toContain('Get-CimInstance')
				expect(args.join(' ')).toContain('ConvertTo-Json')
				return JSON.stringify([
					{
						ProcessId: 8123,
						ParentProcessId: 431,
						CommandLine: command,
						CreationTime: '2026-10-22T10:00:00.000+08:00',
						UserModeTime: '20000000',
						KernelModeTime: '10000000',
					},
				])
			},
		})
		expect(result).toEqual([{ pid: 8123, ppid: 431, command, stime: '2026-10-22T10:00:00.000+08:00', time: '3.00' }])
	})
	it('accepts both one-item and empty CIM outputs', () => {
		expect(getNodeProcesses({ platform: 'win32', run: () => '[]' })).toEqual([])
		expect(
			getNodeProcesses({
				platform: 'win32',
				run: () =>
					JSON.stringify({
						ProcessId: 2,
						ParentProcessId: 1,
						CommandLine: 'node.exe app.js',
						CreationTime: '',
						UserModeTime: '0',
						KernelModeTime: '0',
					}),
			})
		).toEqual([{ pid: 2, ppid: 1, command: 'node.exe app.js', stime: '', time: '0.00' }])
	})
	it('falls back from powershell.exe to pwsh.exe only when the executable is absent', () => {
		const result = getNodeProcesses({
			platform: 'win32',
			run: (file) => {
				if (file === 'powershell.exe') throw commandFailure(null, '', 'ENOENT')
				if (file === 'pwsh.exe')
					return JSON.stringify([{ ProcessId: 42, ParentProcessId: 1, CommandLine: 'node.exe fallback.js' }])
				throw new Error('unexpected fallback')
			},
		})
		expect(result[0]).toMatchObject({ pid: 42, command: 'node.exe fallback.js' })
		expect(() =>
			getNodeProcesses({
				platform: 'win32',
				run: () => {
					throw commandFailure(1, 'Access denied')
				},
			})
		).toThrow('Access denied')
	})
	it('reports malformed JSON or missing process IDs instead of treating protocol failures as an empty machine', () => {
		expect(() => getNodeProcesses({ platform: 'win32', run: () => '{bad' })).toThrow('JSON')
		expect(() => getNodeProcesses({ platform: 'win32', run: () => '[{"CommandLine":"node.exe"}]' })).toThrow('PID')
	})
})

it('discovers a real owned Node child with its complete fixture marker', async () => {
	const marker = `mito-discovery-${Date.now()}-带空格,a`
	const child = spawn(process.execPath, ['-e', "console.log('READY'); setInterval(() => {}, 1000)", marker], {
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	children.push(child)
	if (!child.stdout) throw new Error('Fixture stdout unavailable')
	await once(child.stdout, 'data')
	// 真实进程字段校验不测冷启动延迟；Windows 共享 runner 的首次 CIM 查询可能超过交互查询预算。
	// 超时与权限失败仍由上方独立用例验证，生产查询继续使用自己的时间限制。
	const processes = getNodeProcesses({
		run: (file, args, options) => execFileSync(file, args, { ...options, timeout: 30000 }),
	})
	const discovered = processes.find((proc) => proc.pid === child.pid)
	expect(discovered).toMatchObject({ pid: child.pid, ppid: process.pid })
	expect(discovered?.command).toContain(marker)
}, 40000)

it('requests UTF-8 from PowerShell so native stdout encoding cannot corrupt Chinese commands', () => {
	const found = getNodeProcesses({
		platform: 'win32',
		run: (_file, args, options) => {
			expect(args.at(-1)).toContain('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8')
			expect(options.encoding).toBe('utf8')
			return JSON.stringify([{ ProcessId: 7, ParentProcessId: 1, CommandLine: 'node.exe C:\\项目\\入口.js' }])
		},
	})
	expect(found[0].command).toBe('node.exe C:\\项目\\入口.js')
})

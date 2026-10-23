import { type ExecFileSyncOptionsWithStringEncoding, execFileSync } from 'node:child_process'

export interface NodeProcess {
	pid: number
	ppid: number
	stime: string
	time: string
	command: string
}

export type ProcessCommandRunner = (
	file: string,
	args: string[],
	options: ExecFileSyncOptionsWithStringEncoding
) => string

export interface ProcessDiscoveryOptions {
	platform?: NodeJS.Platform
	run?: ProcessCommandRunner
}

interface CommandFailure extends Error {
	status?: number | null
	code?: string
	stderr?: string | Buffer
	stdout?: string | Buffer
}

const commandOptions: ExecFileSyncOptionsWithStringEncoding = {
	encoding: 'utf8',
	timeout: 5000,
	maxBuffer: 4 * 1024 * 1024,
	windowsHide: true,
	stdio: ['ignore', 'pipe', 'pipe'],
}

function failureText(error: unknown): string {
	const failed = error as CommandFailure
	const stderr = failed.stderr?.toString().trim()
	return stderr || [failed.code, failed.message].filter(Boolean).join(': ') || String(error)
}

function noMatches(error: unknown): boolean {
	const failed = error as CommandFailure
	return failed.status === 1 && !failed.code && !failed.stderr?.toString().trim() && !failed.stdout?.toString().trim()
}

function execute(run: ProcessCommandRunner, file: string, args: string[], options = commandOptions): string {
	try {
		return run(file, args, options)
	} catch (error) {
		throw Object.assign(new Error(`读取 Node.js 进程失败 (${file}): ${failureText(error)}`), { cause: error })
	}
}

function unixProcesses(run: ProcessCommandRunner, platform: NodeJS.Platform): NodeProcess[] {
	let output: string
	try {
		output = run('pgrep', ['-x', 'node|nodejs'], commandOptions)
	} catch (error) {
		// pgrep 的 1 表示没有匹配；权限、语法、缺失程序和超时不能伪装成空列表。
		if (noMatches(error)) return []
		throw Object.assign(new Error(`读取 Node.js 进程失败 (pgrep): ${failureText(error)}`), { cause: error })
	}
	if (!output.trim()) return []
	const ids = output.trim().split(/\s+/)
	if (ids.some((value) => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)) {
		throw new Error('pgrep 返回了无效 PID，未执行进程详情查询')
	}
	let details: string
	try {
		// 固定列和英文日期消除默认布局差异；字符集必须保留 UTF-8，否则 macOS ps 会转义中文参数。
		details = run('ps', ['-ww', '-p', [...new Set(ids)].join(','), '-o', 'pid=,ppid=,lstart=,time=,args='], {
			...commandOptions,
			env: { ...process.env, LC_ALL: '', LC_TIME: 'C', LC_CTYPE: platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8' },
		})
	} catch (error) {
		// 枚举后目标可自然退出；只接受无输出且无诊断信息的 ps「无匹配」结果。
		if (noMatches(error)) return []
		throw Object.assign(new Error(`读取 Node.js 进程失败 (ps): ${failureText(error)}`), { cause: error })
	}
	const wanted = new Set(ids.map(Number))
	return details
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.map((line) => {
			const row =
				/^\s*(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.+)$/.exec(
					line
				)
			if (!row || !wanted.has(Number(row[1])) || !Number.isSafeInteger(Number(row[2]))) {
				throw new Error('无法解析 ps 进程详情；请确认系统 ps 支持 pid/ppid/lstart/time/args 字段')
			}
			return {
				pid: Number(row[1]),
				ppid: Number(row[2]),
				stime: row[3].replace(/\s+/g, ' '),
				time: row[4],
				command: row[5],
			}
		})
		.sort((a, b) => a.pid - b.pid)
}

// Windows PowerShell 的默认控制台编码可能是 OEM；显式 UTF-8 与 Node 的解码设置匹配。
const cimScript = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; $items = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, CommandLine, @{Name='CreationTime';Expression={if ($_.CreationDate) {$_.CreationDate.ToString('o')} else {''}}}, UserModeTime, KernelModeTime); ConvertTo-Json -InputObject $items -Depth 3 -Compress`

function windowsProcesses(run: ProcessCommandRunner): NodeProcess[] {
	const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', cimScript]
	let output: string
	try {
		output = run('powershell.exe', args, commandOptions)
	} catch (error) {
		// PowerShell 7 可替代缺失的 Windows PowerShell；查询失败时降级会掩盖权限错误。
		if ((error as CommandFailure).code !== 'ENOENT') {
			throw Object.assign(new Error(`读取 Node.js 进程失败 (powershell.exe): ${failureText(error)}`), { cause: error })
		}
		output = execute(run, 'pwsh.exe', args)
	}
	let decoded: unknown
	try {
		decoded = JSON.parse(output.replace(/^\uFEFF/, ''))
	} catch (error) {
		throw Object.assign(new Error('无法解析 PowerShell 进程 JSON，请确认 Get-CimInstance 查询成功'), { cause: error })
	}
	if (!decoded || typeof decoded !== 'object') throw new Error('PowerShell 进程 JSON 结构无效')
	const rows: unknown[] = Array.isArray(decoded) ? decoded : [decoded]
	return rows
		.map((value) => {
			const row = value as Record<string, unknown>
			if (!row || !Number.isSafeInteger(row.ProcessId) || Number(row.ProcessId) <= 0) {
				throw new Error('PowerShell 进程 JSON 包含无效 PID')
			}
			if (
				row.ParentProcessId !== undefined &&
				(!Number.isSafeInteger(row.ParentProcessId) || Number(row.ParentProcessId) < 0)
			) {
				throw new Error('PowerShell 进程 JSON 包含无效父 PID')
			}
			const userTime = Number(row.UserModeTime)
			const kernelTime = Number(row.KernelModeTime)
			const time =
				Number.isFinite(userTime) && Number.isFinite(kernelTime) && userTime >= 0 && kernelTime >= 0
					? ((userTime + kernelTime) / 10000000).toFixed(2)
					: ''
			return {
				pid: Number(row.ProcessId),
				ppid: Number(row.ParentProcessId ?? 0),
				stime: typeof row.CreationTime === 'string' ? row.CreationTime : '',
				time,
				// CIM 在无法读取其他用户的命令行时返回 null；保留 PID 并明确显示缺失信息。
				command:
					typeof row.CommandLine === 'string' && row.CommandLine ? row.CommandLine : 'node.exe（命令行不可读取）',
			}
		})
		.sort((a, b) => a.pid - b.pid)
}

// 空数组仅表示成功枚举后没有目标；系统查询失败会抛错，使 TUI 能区分空状态与读取故障。
export function getNodeProcesses(options: ProcessDiscoveryOptions = {}): NodeProcess[] {
	const run = options.run ?? execFileSync
	const platform = options.platform ?? process.platform
	return platform === 'win32' ? windowsProcesses(run) : unixProcesses(run, platform)
}

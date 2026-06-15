import { execSync } from 'node:child_process'

export interface NodeProcess {
	pid: number
	ppid: number
	stime: string
	time: string
	command: string
}

function getNodeProcessesWindows(): NodeProcess[] {
	try {
		// wmic 在 Windows 11+ 可能不可用，优先用 PowerShell
		const output = execSync(
			'powershell -Command "Get-Process node -ErrorAction SilentlyContinue | Select-Object Id,StartTime,CPU,CommandLine | ConvertTo-Csv -NoTypeInformation"',
			{ encoding: 'utf8' }
		).trim()

		if (!output) {
			return []
		}

		const lines = output.split('\n').slice(1)
		return lines
			.map((line) => {
				const parts = line.replace(/"/g, '').split(',')
				const pid = parseInt(parts[0])
				const stime = parts[1] || ''
				const time = parts[2] || '0'
				const command = parts.slice(3).join(',') || 'node'
				return { pid, ppid: 0, stime, time, command }
			})
			.filter((proc) => proc.pid && !Number.isNaN(proc.pid))
	} catch {
		// PowerShell 失败时回退到 tasklist
		try {
			const output = execSync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH', { encoding: 'utf8' }).trim()
			if (!output || output.includes('No tasks')) {
				return []
			}
			return output
				.split('\n')
				.map((line) => {
					const parts = line.replace(/"/g, '').split(',')
					const pid = parseInt(parts[1])
					return { pid, ppid: 0, stime: '', time: '', command: parts[0] }
				})
				.filter((proc) => proc.pid && !Number.isNaN(proc.pid))
		} catch {
			return []
		}
	}
}

function getNodeProcessesUnix(): NodeProcess[] {
	try {
		const pids = execSync('pgrep node', { encoding: 'utf8' }).trim()
		if (!pids) {
			return []
		}

		const output = execSync(`ps -fxp ${pids.split('\n').join(' ')}`, { encoding: 'utf8' })
		const lines = output.trim().split('\n').slice(1)

		return lines
			.map((line) => {
				const parts = line.trim().split(/\s+/)
				const pid = parseInt(parts[1])
				const ppid = parseInt(parts[2])
				const stime = parts[4]
				const time = parts[6]
				const command = parts.slice(7).join(' ')

				return { pid, ppid, stime, time, command }
			})
			.filter((proc) => proc.pid && !Number.isNaN(proc.pid))
	} catch {
		return []
	}
}

export function getNodeProcesses(): NodeProcess[] {
	if (process.platform === 'win32') {
		return getNodeProcessesWindows()
	}
	return getNodeProcessesUnix()
}

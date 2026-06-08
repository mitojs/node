import { execSync } from 'node:child_process'

export interface NodeProcess {
	pid: number
	ppid: number
	stime: string
	time: string
	command: string
}

// 依赖 pgrep + ps 命令，仅支持 macOS / Linux。Windows 需要改用 tasklist 实现。
export function getNodeProcesses(): NodeProcess[] {
	if (process.platform === 'win32') {
		return []
	}
	try {
		// 使用 pgrep 获取 Node.js 进程 PID，然后用 ps 获取详细信息
		const pids = execSync('pgrep node', { encoding: 'utf8' }).trim()
		if (!pids) {
			return []
		}

		const output = execSync(`ps -fxp ${pids.split('\n').join(' ')}`, { encoding: 'utf8' })
		const lines = output.trim().split('\n').slice(1) // 跳过标题行

		return lines
			.map((line) => {
				const parts = line.trim().split(/\s+/)
				const pid = parseInt(parts[1])
				const ppid = parseInt(parts[2])
				const stime = parts[4]
				const time = parts[6]
				const command = parts.slice(7).join(' ') // ps -f 格式中命令从第8列开始

				return { pid, ppid, stime, time, command }
			})
			.filter((proc) => proc.pid && !Number.isNaN(proc.pid))
	} catch (error) {
		return []
	}
}

import type { DiscoveredNodeProcess } from './discover.js'

export function formatDiscoverTable(processes: DiscoveredNodeProcess[]) {
	if (processes.length === 0) {
		return 'No Node.js processes found'
	}

	const rows = [
		['PID', 'PPID', 'START', 'CPU', 'INSPECTOR', 'COMMAND'],
		...processes.map((processInfo) => [
			String(processInfo.pid),
			String(processInfo.ppid),
			processInfo.startTime,
			processInfo.cpuTime,
			processInfo.inspector.enabled ? String(processInfo.inspector.port) : '-',
			processInfo.command,
		]),
	]
	const widths = rows[0].map((_, columnIndex) => {
		return Math.max(...rows.map((row) => row[columnIndex].length))
	})

	return rows
		.map((row) => {
			return row
				.map((cell, columnIndex) => cell.padEnd(widths[columnIndex]))
				.join('  ')
				.trimEnd()
		})
		.join('\n')
}

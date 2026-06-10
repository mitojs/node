import { execFile } from 'node:child_process'
import http from 'node:http'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface DiscoveredProcessBase {
	pid: number
	ppid: number
	startTime: string
	cpuTime: string
	command: string
}

export interface DiscoveredNodeProcess extends DiscoveredProcessBase {
	inspector: {
		enabled: boolean
		port: number | null
	}
}

interface DiscoverOptions {
	includeSelf?: boolean
}

interface DiscoverDeps {
	currentPid: number
	getPsOutput: () => Promise<string>
	getListeningTcpPorts: () => Promise<ListeningTcpPort[]>
	isInspectorPort: (pid: number, port: number) => Promise<boolean>
}

const DEFAULT_INSPECTOR_PORT = 9229

interface ListeningTcpPort {
	pid: number
	port: number
}

function isNodeCommand(command: string) {
	return /(^|\s|\/)node(\s|$)/.test(command) || command.includes('/node ')
}

function isCurrentCliProcess(processInfo: DiscoveredProcessBase, currentPid: number) {
	return processInfo.pid === currentPid || /mito-node|cli\.mjs/.test(processInfo.command)
}

function parseInspectorPortFromCommand(command: string) {
	const match = command.match(/--inspect(?:-brk)?(?:=(?:(?:[^:\s]+):)?(\d+))?/)
	if (!match) {
		return null
	}

	return match[1] ? Number(match[1]) : DEFAULT_INSPECTOR_PORT
}

function parsePortFromAddress(address: string) {
	const match = address.match(/:(\d+)(?:\s|$)/)
	return match ? Number(match[1]) : null
}

export function parsePsOutput(output: string): DiscoveredProcessBase[] {
	return output
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !line.startsWith('PID '))
		.map((line) => {
			const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/)
			if (!match) {
				return null
			}

			return {
				pid: Number(match[1]),
				ppid: Number(match[2]),
				startTime: match[3],
				cpuTime: match[4],
				command: match[5],
			}
		})
		.filter((processInfo): processInfo is DiscoveredProcessBase => {
			return processInfo !== null && Number.isFinite(processInfo.pid) && Number.isFinite(processInfo.ppid)
		})
}

export function parseLsofListenOutput(output: string): ListeningTcpPort[] {
	const ports: ListeningTcpPort[] = []
	let currentPid: number | null = null

	output
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.forEach((line) => {
			if (/^p\d+$/.test(line)) {
				currentPid = Number(line.slice(1))
				return
			}

			if (line.startsWith('n') && currentPid !== null) {
				const port = parsePortFromAddress(line.slice(1))
				if (port !== null) {
					ports.push({ pid: currentPid, port })
				}
			}
		})

	return ports
}

async function getPsOutput() {
	const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,start=,time=,command='])
	return stdout
}

async function getListeningTcpPorts() {
	try {
		const { stdout } = await execFileAsync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-FpPn'])
		return parseLsofListenOutput(stdout)
	} catch {
		return []
	}
}

async function isInspectorPort(_pid: number, port: number) {
	return new Promise<boolean>((resolve) => {
		const request = http.get(`http://127.0.0.1:${port}/json`, (response) => {
			let body = ''

			response.setEncoding('utf8')
			response.on('data', (chunk: string) => {
				body += chunk
			})
			response.on('end', () => {
				try {
					const targets = JSON.parse(body)
					resolve(
						Array.isArray(targets) &&
							targets.some((target) => target?.type === 'node' && typeof target.webSocketDebuggerUrl === 'string')
					)
				} catch {
					resolve(false)
				}
			})
		})

		request.setTimeout(300, () => {
			request.destroy()
			resolve(false)
		})
		request.on('error', () => {
			resolve(false)
		})
	})
}

const defaultDeps: DiscoverDeps = {
	currentPid: process.pid,
	getPsOutput,
	getListeningTcpPorts,
	isInspectorPort,
}

async function findInspectorPort(
	processInfo: DiscoveredProcessBase,
	listeningPorts: ListeningTcpPort[],
	deps: DiscoverDeps
) {
	const commandPort = parseInspectorPortFromCommand(processInfo.command)
	if (commandPort !== null) {
		return commandPort
	}

	const candidatePorts = listeningPorts
		.filter((portInfo) => portInfo.pid === processInfo.pid)
		.map((portInfo) => portInfo.port)
	for (const port of candidatePorts) {
		if (await deps.isInspectorPort(processInfo.pid, port)) {
			return port
		}
	}

	return null
}

export async function discoverNodeProcesses(options: DiscoverOptions = {}, deps: DiscoverDeps = defaultDeps) {
	const processes = parsePsOutput(await deps.getPsOutput())
	const listeningPorts = await deps.getListeningTcpPorts()
	const candidates = processes
		.filter((processInfo) => isNodeCommand(processInfo.command))
		.filter((processInfo) => options.includeSelf || !isCurrentCliProcess(processInfo, deps.currentPid))
		.sort((a, b) => a.pid - b.pid)

	return Promise.all(
		candidates.map(async (processInfo): Promise<DiscoveredNodeProcess> => {
			const port = await findInspectorPort(processInfo, listeningPorts, deps)
			return {
				...processInfo,
				inspector: {
					enabled: port !== null,
					port,
				},
			}
		})
	)
}

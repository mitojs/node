import { execFile } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { promisify } from 'node:util'
import WebSocket from 'ws'
import { InspectorClient } from './client.js'

const execFileAsync = promisify(execFile)

interface InspectorTarget {
	webSocketDebuggerUrl?: string
}

interface OpenInspectorSessionOptions {
	pid: number
	port: number
}

export interface InspectorSession {
	client: InspectorClient
	openedByCli: boolean
	close(): Promise<void>
}

interface OpenInspectorSessionDeps {
	ensurePidExists: (pid: number) => void
	isPortReachable: (port: number) => Promise<boolean>
	getPortOwnerPid: (port: number) => Promise<number | null>
	openInspector: (pid: number) => void
	waitForInspector: (port: number) => Promise<void>
	readInspectorTargets: (port: number) => Promise<InspectorTarget[]>
	connectWebSocket: (url: string) => Promise<WebSocket>
	createClient: (socket: WebSocket) => InspectorClient
}

const DEFAULT_HOST = '127.0.0.1'
const CLOSE_INSPECTOR_TIMEOUT_MS = 2000
const CLOSE_INSPECTOR_EXPRESSION = `(() => {
	try {
		require('inspector').close()
		return true
	} catch (error) {
		return false
	}
})()`

function isExpectedCloseError(error: unknown) {
	return error instanceof Error && error.message.includes('inspector connection closed')
}

function ensurePidExists(pid: number) {
	try {
		process.kill(pid, 0)
	} catch (error) {
		throw new Error(`target pid is not available: ${pid}: ${(error as Error).message}`)
	}
}

function isPortReachable(port: number) {
	return new Promise<boolean>((resolve) => {
		const socket = net.connect(port, DEFAULT_HOST)
		const done = (reachable: boolean) => {
			socket.destroy()
			resolve(reachable)
		}

		socket.setTimeout(300)
		socket.on('connect', () => done(true))
		socket.on('timeout', () => done(false))
		socket.on('error', () => done(false))
	})
}

function openInspector(pid: number) {
	process.kill(pid, 'SIGUSR1')
}

async function getPortOwnerPid(port: number) {
	try {
		const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'])
		const owner = stdout
			.split('\n')
			.map((line) => line.trim())
			.find((line) => /^p\d+$/.test(line))

		return owner ? Number(owner.slice(1)) : null
	} catch {
		return null
	}
}

async function waitForInspector(port: number) {
	for (let i = 0; i < 20; i++) {
		if (await isPortReachable(port)) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, 250))
	}

	throw new Error(`inspector port did not open: ${port}`)
}

function readInspectorTargets(port: number) {
	return new Promise<InspectorTarget[]>((resolve, reject) => {
		const request = http.get(`http://${DEFAULT_HOST}:${port}/json`, (response) => {
			let body = ''

			response.setEncoding('utf8')
			response.on('data', (chunk: string) => {
				body += chunk
			})
			response.on('end', () => {
				try {
					resolve(JSON.parse(body))
				} catch (error) {
					reject(new Error(`failed to parse inspector targets: ${(error as Error).message}`))
				}
			})
		})

		request.on('error', (error) => {
			reject(new Error(`failed to read inspector targets: ${error.message}`))
		})
	})
}

function connectWebSocket(url: string) {
	return new Promise<WebSocket>((resolve, reject) => {
		const socket = new WebSocket(url)
		socket.on('open', () => resolve(socket))
		socket.on('error', (error) => reject(new Error(`failed to connect inspector websocket: ${error.message}`)))
	})
}

const defaultDeps: OpenInspectorSessionDeps = {
	ensurePidExists,
	isPortReachable,
	getPortOwnerPid,
	openInspector,
	waitForInspector,
	readInspectorTargets,
	connectWebSocket,
	createClient: (socket) => new InspectorClient(socket),
}

export async function openInspectorSession(
	options: OpenInspectorSessionOptions,
	deps: OpenInspectorSessionDeps = defaultDeps
): Promise<InspectorSession> {
	deps.ensurePidExists(options.pid)

	const alreadyReachable = await deps.isPortReachable(options.port)
	if (!alreadyReachable) {
		deps.openInspector(options.pid)
		await deps.waitForInspector(options.port)
	}

	const ownerPid = await deps.getPortOwnerPid(options.port)
	if (ownerPid !== options.pid) {
		const owner = ownerPid === null ? 'unknown pid' : `pid ${ownerPid}`
		throw new Error(`inspector port ${options.port} is owned by ${owner}, not target pid ${options.pid}`)
	}

	const targets = await deps.readInspectorTargets(options.port)
	const webSocketDebuggerUrl = targets.find((target) => target.webSocketDebuggerUrl)?.webSocketDebuggerUrl
	if (!webSocketDebuggerUrl) {
		throw new Error(`no inspector websocket target found on port ${options.port}`)
	}

	const socket = await deps.connectWebSocket(webSocketDebuggerUrl)
	const client = deps.createClient(socket)

	return {
		client,
		openedByCli: !alreadyReachable,
		async close() {
			try {
				if (!alreadyReachable) {
					try {
						await client.evaluate(CLOSE_INSPECTOR_EXPRESSION, CLOSE_INSPECTOR_TIMEOUT_MS)
					} catch (error) {
						if (!isExpectedCloseError(error)) {
							throw error
						}
					}
				}
			} finally {
				client.close()
			}
		},
	}
}

import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// This harness records actual terminal bytes and viewport changes; screenshots are captured separately from the live native window.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = process.env.MITO_EVIDENCE_DIR
	? path.resolve(process.env.MITO_EVIDENCE_DIR)
	: path.join(root, 'docs/reports/evidence/session')
mkdirSync(evidence, { recursive: true })
process.chdir(evidence)
process.env.MITO_HISTORY_DIR = path.join(evidence, 'history')
async function availablePort() {
	const server = net.createServer()
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = server.address().port
	await new Promise((resolve) => server.close(resolve))
	return port
}
const agentPort = await availablePort()
const inspectorPort = await availablePort()
// Configure an isolated Inspector port without enabling it; Agent-only polling must leave it closed.
const target = spawn(
	process.execPath,
	[`--inspect-port=127.0.0.1:${inspectorPort}`, path.join(root, 'demos/diagnostic-target.mjs')],
	{
		env: { ...process.env, MITO_AGENT_TCP_PORT: String(agentPort) },
		stdio: ['ignore', 'pipe', 'pipe'],
	}
)
let targetStderr = ''
target.stderr.on('data', (chunk) => {
	targetStderr += chunk
	writeFileSync(path.join(evidence, 'target-stderr.log'), targetStderr)
})
await new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error('SDK target startup timed out')), 15000)
	let buffer = ''
	target.stdout.on('data', (chunk) => {
		buffer += chunk
		if (buffer.includes('"ready":true')) {
			clearTimeout(timer)
			resolve()
		}
	})
	target.once('error', reject)
	target.once('exit', (code) => {
		clearTimeout(timer)
		reject(new Error(`SDK target exited ${code}: ${targetStderr}`))
	})
})
const session = {
	pid: process.pid,
	targetPid: target.pid,
	agentPort,
	inspectorPort,
	startedAt: new Date().toISOString(),
}
writeFileSync(path.join(evidence, 'session.json'), JSON.stringify(session, null, 2))
const capture = path.join(evidence, 'native-terminal.cast')
const started = performance.now()
writeFileSync(
	capture,
	`${JSON.stringify({ version: 2, width: process.stdout.columns, height: process.stdout.rows, timestamp: Math.floor(Date.now() / 1000), env: { TERM: process.env.TERM || 'xterm-256color' }, title: 'MitoJS Node C diagnostic workbench local self-test' })}\n`
)
const originalWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = (chunk, ...args) => {
	appendFileSync(capture, `${JSON.stringify([(performance.now() - started) / 1000, 'o', String(chunk)])}\n`)
	return originalWrite(chunk, ...args)
}
const recordViewport = () =>
	appendFileSync(
		path.join(evidence, 'viewport.jsonl'),
		`${JSON.stringify({ at: new Date().toISOString(), columns: process.stdout.columns, rows: process.stdout.rows })}\n`
	)
recordViewport()
process.stdout.on('resize', recordViewport)
try {
	const { startInteractive } = await import('../packages/node-cli/dist/interactive-cli.mjs')
	await startInteractive({ pid: target.pid, agentPort, port: inspectorPort })
} finally {
	process.stdout.write = originalWrite
	process.stdout.off('resize', recordViewport)
	if (target.exitCode === null) {
		target.kill('SIGTERM')
		await new Promise((resolve) => target.once('exit', resolve))
	}
	writeFileSync(
		path.join(evidence, 'session.json'),
		JSON.stringify({ ...session, endedAt: new Date().toISOString(), targetExitCode: target.exitCode }, null, 2)
	)
}

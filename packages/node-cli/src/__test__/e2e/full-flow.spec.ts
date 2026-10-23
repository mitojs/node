import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../../../../..')
const cli = path.join(root, 'packages/node-cli/dist/cli.mjs')
const evidence = path.join(root, 'docs/reports/implementation/e2e-current.json')
const resources: Array<() => Promise<void>> = []
const records: unknown[] = []
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
afterEach(async () => {
	for (const cleanup of resources.splice(0).reverse()) await cleanup()
})
afterAll(async () => {
	await mkdir(path.dirname(evidence), { recursive: true })
	await writeFile(evidence, JSON.stringify({ at: new Date().toISOString(), node: process.version, records }, null, 2))
})

async function freePort() {
	const server = net.createServer()
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = (server.address() as net.AddressInfo).port
	await new Promise<void>((resolve) => server.close(() => resolve()))
	return port
}
async function stop(child: ChildProcess) {
	if (child.exitCode !== null || child.signalCode !== null) return
	const exited = once(child, 'exit')
	child.kill('SIGTERM')
	const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
	await exited
	clearTimeout(timer)
}
async function fixture(format: 'esm' | 'cjs' | 'none', preopened = false) {
	const agentPort = await freePort()
	const inspectorPort = await freePort()
	const directory = await mkdtemp(path.join(tmpdir(), 'mito-e2e-'))
	resources.push(() => rm(directory, { recursive: true, force: true }))
	const sdkPath = path.join(root, 'packages/node/dist/index.js')
	const source = `
		${format === 'esm' ? `import { MitoNode } from ${JSON.stringify(sdkPath)}; import inspector from 'node:inspector';` : `const inspector = require('node:inspector'); ${format === 'cjs' ? `const { MitoNode } = require(${JSON.stringify(sdkPath)});` : ''}`}
		(async () => {
			${format !== 'none' ? `const sdk = new MitoNode({ metrics: { CPU: { interval: 250 }, Memory: { interval: 250 }, JSError: true, Timeout: true } }); await sdk.start(); globalThis.__sdkForE2E = sdk;` : ''}
			const retained = []; const timers = [];
			function actualBusyFrame() { const end = performance.now()+35; let checksum=0; while(performance.now()<end) { for(let index=0;index<10000;index++) checksum+=Math.sqrt(index+checksum%17); } globalThis.workloadChecksum=checksum; }
			const workload = setInterval(() => { actualBusyFrame(); retained.push(new Array(200).fill('e2e')); timers.push(setTimeout(()=>{}, 60000)); }, 100);
			process.on('uncaughtException', () => {});
			process.on('message', (message) => {
				if(message.action === 'probe') process.send({ inspector: inspector.url() || null });
				if(message.action === 'error') setTimeout(function realAsyncFailure(){ throw new Error('owned-e2e-error'); }, 0);
			});
			process.once('SIGTERM', async () => { clearInterval(workload); timers.forEach(clearTimeout); ${format !== 'none' ? 'await sdk.destroy();' : ''} process.exit(0); });
			process.send({ ready: true, pid: process.pid, inspector: inspector.url() || null });
		})();
	`
	const args = [
		preopened ? `--inspect=127.0.0.1:${inspectorPort}` : `--inspect-port=127.0.0.1:${inspectorPort}`,
		...(format === 'esm' ? ['--input-type=module'] : []),
		'-e',
		source,
	]
	const target = spawn(process.execPath, args, {
		env: { ...process.env, MITO_AGENT_TCP_PORT: String(agentPort) },
		stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
	})
	resources.push(() => stop(target))
	let stderr = ''
	target.stderr!.on('data', (chunk) => {
		stderr += chunk
	})
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`fixture not ready: ${stderr}`)), 15000)
		target.on('message', (message: any) => {
			if (message.ready) {
				clearTimeout(timer)
				resolve()
			}
		})
		target.once('error', reject)
		target.once('exit', (code) => {
			clearTimeout(timer)
			reject(new Error(`fixture exited ${code}: ${stderr}`))
		})
	})
	if (format !== 'none') {
		const info = (await fetch(`http://127.0.0.1:${agentPort}/info`).then((res) => res.json())) as { pid: number }
		// These ports are freshly allocated and only this fixture can have started this daemon.
		resources.splice(resources.length - 1, 0, async () => {
			try {
				process.kill(info.pid, 'SIGTERM')
			} catch {}
		})
	}
	async function probe() {
		const response = once(target, 'message')
		target.send({ action: 'probe' })
		return (await response)[0] as { inspector: string | null }
	}
	async function run(command: string, options: string[] = []) {
		const result = await invoke([
			command,
			'-p',
			String(target.pid),
			'--port',
			String(inspectorPort),
			'--agent-port',
			String(agentPort),
			'--history-dir',
			path.join(directory, 'history'),
			'--json',
			...options,
		])
		records.push({ format, pid: target.pid, command, ...result })
		return result
	}
	return { target, agentPort, inspectorPort, directory, run, probe }
}
async function invoke(args: string[], cancelAfter?: number) {
	const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
	let stdout = ''
	let stderr = ''
	child.stdout.on('data', (chunk) => {
		stdout += chunk
	})
	child.stderr.on('data', (chunk) => {
		stderr += chunk
	})
	const limit = setTimeout(() => child.kill('SIGKILL'), 25000)
	const cancel = cancelAfter === undefined ? undefined : setTimeout(() => child.kill('SIGINT'), cancelAfter)
	const [status, signal] = await once(child, 'exit')
	clearTimeout(limit)
	if (cancel) clearTimeout(cancel)
	const lines = stdout.trim().split('\n')
	expect(lines, `stdout must be one JSON result: ${stdout}; stderr=${stderr}`).toHaveLength(1)
	return { status, signal, result: JSON.parse(lines[0]), stderr }
}
async function until<T>(sample: () => Promise<T>, accept: (value: T) => boolean, timeout = 8000) {
	const started = Date.now()
	let value: T
	do {
		value = await sample()
		if (accept(value)) return value
		await delay(100)
	} while (Date.now() - started < timeout)
	throw new Error(`condition not reached: ${JSON.stringify(value!)}`)
}

describe('real SDK → native Agent → built CLI acceptance', () => {
	it.each(['esm', 'cjs'] as const)(
		'%s SDK serves fresh real metrics without opening Inspector and captures real error stacks',
		async (format) => {
			const test = await fixture(format)
			await until(
				() => fetch(`http://127.0.0.1:${test.agentPort}/metrics/${test.target.pid}`).then((res) => res.json()),
				(value: any) => value.data?.timers?.length > 0
			)
			for (const command of ['memory', 'monitor-cpu', 'monitor-memory', 'timers', 'errors']) {
				const { status, result } = await test.run(command)
				expect(status).toBe(0)
				expect(result).toMatchObject({ success: true, command, data: { source: 'agent' } })
				if (command === 'memory') expect(result.data.memory.rss).toBeGreaterThan(0)
				if (command === 'monitor-memory') expect(result.data.rss).toBeGreaterThan(0)
				if (command === 'monitor-cpu') expect(result.data.cpuPercent).toBeGreaterThanOrEqual(0)
				if (command === 'timers') expect(result.data.timers.some((timer: any) => timer.stack?.length > 0)).toBe(true)
				if (command === 'errors') expect(result.data.errors).toEqual([])
			}
			expect((await test.probe()).inspector).toBeNull()
			test.target.send({ action: 'error' })
			const failure = await until(
				() => test.run('errors'),
				(value) => value.result.data?.errors?.some((error: any) => JSON.stringify(error).includes('owned-e2e-error'))
			)
			expect(JSON.stringify(failure.result.data.errors)).toContain('realAsyncFailure')
		}
	)

	it('uses Inspector without SDK, preserves an existing debugger, and returns SDK_REQUIRED for timers', async () => {
		const test = await fixture('none', true)
		const memory = await test.run('memory')
		expect(memory).toMatchObject({
			status: 0,
			result: { success: true, data: { source: 'inspector', memory: { rss: expect.any(Number) } } },
		})
		expect(memory.result.data.memory.rss).toBeGreaterThan(0)
		expect((await test.probe()).inspector).toContain(String(test.inspectorPort))
		expect(await test.run('timers')).toMatchObject({ status: 1, result: { success: false, errorCode: 'SDK_REQUIRED' } })
		const own = await test.run('run-code', ['--code', 'process.pid'])
		expect(own.result.data).toBe(test.target.pid)
	})

	it('falls back from genuinely stale Agent metrics, then closes only the Inspector it enabled', async () => {
		const test = await fixture('esm')
		await until(
			() => test.run('monitor-memory'),
			(value) => value.result.data?.source === 'agent'
		)
		const stopped = await test.run('run-code', ['--code', 'await globalThis.__sdkForE2E.destroy(); return true'])
		expect(stopped.status).toBe(0)
		await fetch(`http://127.0.0.1:${test.agentPort}/ipc/register_process`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pid: test.target.pid, subjects: ['Memory'], intervals: { Memory: 10 } }),
		})
		// A single real Agent sample expires after the SDK has stopped collecting in the live application.
		await fetch(`http://127.0.0.1:${test.agentPort}/metrics/push`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				pid: test.target.pid,
				subject: 'Memory',
				data: { memory: { rss: 1, heapUsed: 1, heapTotal: 2 } },
			}),
		})
		await delay(80)
		const result = await test.run('monitor-memory')
		expect(result.result.data.source).toBe('inspector')
		expect(result.result.data.rss).toBeGreaterThan(1)
		expect((await test.probe()).inspector).toBeNull()
	})

	it('saves real profiles/reports under a quoted directory, persists history and compares two reports', async () => {
		const test = await fixture('none', true)
		const artifacts = path.join(test.directory, "quoted ' output")
		const first = await test.run('diagnose', ['--duration', '800', '--scenario', 'all', '--dir', artifacts])
		const second = await test.run('diagnose', ['--duration', '800', '--scenario', 'all', '--dir', artifacts])
		for (const item of [first, second]) {
			expect(item.status).toBe(0)
			// JIT may inline the named loop into its timer callback; both must retain the actual application location.
			expect(item.result.data.cpu.hotspots.some((frame: any) => frame.url === '[eval]' && frame.selfTimeMs > 0)).toBe(
				true
			)
			expect(item.result.data.unavailable.some((entry: any) => entry.kind === 'timers')).toBe(true)
			expect(path.dirname(item.result.data.cpu.profileFilename)).toBe(artifacts)
			const profile = JSON.parse(await readFile(item.result.data.cpu.profileFilename, 'utf8'))
			expect(profile.samples.length).toBeGreaterThan(0)
			for (const frame of item.result.data.cpu.hotspots)
				expect(
					profile.nodes.some(
						(node: any) =>
							(node.callFrame.functionName || '(anonymous)') === frame.functionName && node.callFrame.url === frame.url
					)
				).toBe(true)
		}
		const report = await test.run('report', ['--dir', artifacts])
		expect(report.status).toBe(0)
		expect(JSON.parse(await readFile(report.result.data.filename, 'utf8')).header.processId).toBe(test.target.pid)
		const history = await test.run('history')
		expect(history.result.data.records.length).toBeGreaterThanOrEqual(3)
		const comparison = await test.run('history', [
			'--compare',
			`${first.result.meta.historyId},${second.result.meta.historyId}`,
		])
		expect(comparison.status).toBe(0)
		expect(comparison.result.data.comparison).toBeDefined()
	})

	it('cancels a running real profile with exit130, leaves no partial file, and can profile again', async () => {
		const test = await fixture('none', true)
		const artifacts = path.join(test.directory, 'cancelled')
		const cancelled = await invoke(
			[
				'cpuprofile',
				'-p',
				String(test.target.pid),
				'--port',
				String(test.inspectorPort),
				'--duration',
				'10000',
				'--dir',
				artifacts,
				'--no-history',
				'--json',
			],
			1000
		)
		records.push({ command: 'cancel-profile', ...cancelled })
		expect(cancelled).toMatchObject({ status: 130, result: { success: false, errorCode: 'CANCELLED' } })
		expect(await readdir(artifacts).catch(() => [])).toEqual([])
		expect((await test.probe()).inspector).toContain(String(test.inspectorPort))
		expect(await test.run('cpuprofile', ['--duration', '100', '--dir', artifacts])).toMatchObject({
			status: 0,
			result: { success: true },
		})
	})

	it('bounds unresponsive discovery and returns timeout JSON without killing its target', async () => {
		const test = await fixture('none')
		const server = http.createServer((_req, response) => {
			response.write('[')
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		resources.push(async () => {
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		})
		const started = Date.now()
		const result = await invoke([
			'memory',
			'-p',
			String(test.target.pid),
			'--port',
			String((server.address() as net.AddressInfo).port),
			'--agent-port',
			String(test.agentPort),
			'--timeout',
			'200',
			'--no-history',
			'--json',
		])
		records.push({ command: 'timeout', ...result })
		expect(result).toMatchObject({ status: 1, result: { success: false, errorCode: 'TIMEOUT' } })
		expect(Date.now() - started).toBeLessThan(3000)
		expect(() => process.kill(test.target.pid!, 0)).not.toThrow()
	})
})

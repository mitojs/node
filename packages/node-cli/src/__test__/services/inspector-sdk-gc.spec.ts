import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { type AddressInfo, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { registerBuiltinPlugins } from '../../plugins/index.js'
import { AgentClient } from '../../services/agent-client.js'
import { executeDiagnostic } from '../../services/diagnostic-runner.js'

async function freePort() {
	const server = createServer()
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
	const port = (server.address() as AddressInfo).port
	await new Promise<void>((done) => server.close(() => done()))
	return port
}

function message(target: ChildProcess): Promise<Record<string, unknown>> {
	return new Promise((done, reject) => {
		const timer = setTimeout(() => {
			cleanup()
			reject(new Error('GC fixture IPC timeout'))
		}, 8000)
		const received = (value: unknown) => {
			cleanup()
			done(value as Record<string, unknown>)
		}
		const failed = (error: Error) => {
			cleanup()
			reject(error)
		}
		function cleanup() {
			clearTimeout(timer)
			target.removeListener('message', received)
			target.removeListener('error', failed)
		}
		target.once('message', received)
		target.once('error', failed)
	})
}

// Windows cannot activate an owned Inspector with SIGUSR1; its supported preopened path is tested separately.
it.skipIf(process.platform === 'win32')(
	'saves CPU profiles and releases owned Inspector under actual SDK allocation and forced GC pressure',
	async () => {
		registerBuiltinPlugins()
		const inspectorPort = await freePort()
		const agentPort = await freePort()
		const directory = await mkdtemp(join(tmpdir(), 'mito-sdk-gc-profile-'))
		const sdkEntry = resolve(process.cwd(), '../node/dist/index.js')
		const target = spawn(
			process.execPath,
			[
				'--expose-gc',
				`--inspect-port=127.0.0.1:${inspectorPort}`,
				'-e',
				`
		const { MitoNode } = require(${JSON.stringify(sdkEntry)});
		const inspector = require('node:inspector');
		(async()=>{
			const client = new MitoNode({metrics:{CPU:{interval:10},Memory:{interval:10},JSError:false,Timeout:true}});
			await client.start();
			let gcPasses = 0, allocationPasses = 0;
			const retained = [];
			const allocation = setInterval(function allocateFixtureObjects(){
				retained.push(Array.from({length:500},(_,i)=>({index:i,text:'fixture-value-'+i})));
				if(retained.length>16) retained.shift();
				allocationPasses++;
			},1);
			const gc = setInterval(()=>{global.gc();gcPasses++},2);
			process.on('message',async(command)=>{
				if(command==='probe') process.send({url:inspector.url()||null,gcPasses,allocationPasses});
				if(command==='stop'){clearInterval(allocation);clearInterval(gc);await client.destroy();process.exit(0)}
			});
			process.send({ready:true,pid:process.pid});
		})().catch(error=>{console.error(error);process.exit(1)});
	`,
			],
			{ env: { ...process.env, MITO_AGENT_TCP_PORT: String(agentPort) }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
		)
		let stderr = ''
		target.stderr?.on('data', (chunk) => {
			stderr += chunk
		})
		let agentPid: number | undefined
		try {
			expect(await message(target)).toMatchObject({ ready: true })
			const targetPid = target.pid
			if (!targetPid) throw new Error(`SDK GC fixture did not start: ${stderr}`)
			const info = await fetch(`http://127.0.0.1:${agentPort}/info`).then((response) => response.json())
			expect(info).toMatchObject({ name: 'mitojs-agent', protocol_version: 1 })
			agentPid = info.pid
			// Repeated real sessions exercise the lifetime race; no session or protocol operation is mocked.
			for (let iteration = 0; iteration < 4; iteration++) {
				const result = await executeDiagnostic(
					'cpuprofile',
					{ duration: '150', dir: directory },
					{ pid: targetPid, port: inspectorPort, agentPort, timeout: 8000, recordHistory: false }
				)
				expect(result, `${result.error ?? ''}\n${stderr}`).toMatchObject({ success: true, command: 'cpuprofile' })
				const profile = JSON.parse(await readFile(result.data.filename, 'utf8'))
				expect(profile.endTime).toBeGreaterThan(profile.startTime)
				expect(profile.samples.length).toBeGreaterThan(0)
				const probe = message(target)
				target.send('probe')
				const observed = await probe
				expect(observed.url).toBeNull()
				expect(observed.gcPasses).toBeGreaterThan(0)
				expect(observed.allocationPasses).toBeGreaterThan(0)
			}
			const metrics = await new AgentClient(agentPort).getProcessInfo(targetPid)
			expect(metrics?.metrics?.memory?.memory.rss).toBeGreaterThan(0)
			expect(metrics?.updatedAt.Memory).toBeGreaterThan(0)
		} finally {
			if (target.exitCode === null && target.signalCode === null) {
				await new Promise<void>((done) => {
					const timer = setTimeout(() => target.kill('SIGKILL'), 1000)
					target.once('exit', () => {
						clearTimeout(timer)
						done()
					})
					if (target.connected) target.send('stop')
					else target.kill('SIGKILL')
				})
			}
			if (agentPid && agentPid !== process.pid && agentPid !== target.pid) {
				try {
					process.kill(agentPid, 'SIGTERM')
				} catch {}
			}
			await rm(directory, { recursive: true, force: true })
		}
	},
	20000
)

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const { values } = parseArgs({
	options: {
		output: { type: 'string' },
		keep: { type: 'boolean', default: false },
		'skip-live': { type: 'boolean', default: false },
		'pack-destination': { type: 'string' },
		runtime: { type: 'string' },
	},
})
const report = {
	startedAt: new Date().toISOString(),
	platform: process.platform,
	arch: process.arch,
	node: process.version,
	success: false,
	checks: [],
	packages: [],
	commands: [],
}
const temporary = await mkdtemp(join(tmpdir(), 'mito-package-smoke-'))
const runtime = values.runtime ? resolve(values.runtime) : process.execPath
const project = join(temporary, 'project')
const tarballs = join(temporary, 'tarballs')
const packageManager = process.env.npm_execpath
async function command(name, executable, args, cwd = project) {
	try {
		const result = await exec(executable, args, {
			cwd,
			timeout: 120000,
			maxBuffer: 16 * 1024 * 1024,
			env: { ...process.env, CI: 'true' },
		})
		report.commands.push({ name, exitCode: 0, stdout: result.stdout, stderr: result.stderr })
		return result.stdout
	} catch (error) {
		report.commands.push({ name, exitCode: error.code, stdout: error.stdout, stderr: error.stderr })
		throw new Error(`${name}: ${error.message}`)
	}
}
async function pnpm(name, args, cwd = root) {
	assert(packageManager, 'Run this script through pnpm run pack:local so the pinned package manager is used')
	return command(name, process.execPath, [packageManager, ...args], cwd)
}
function checked(name, details) {
	report.checks.push({ name, success: true, details })
}
async function freePort() {
	const server = createServer()
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = server.address().port
	await new Promise((resolve) => server.close(resolve))
	return port
}
async function stop(child) {
	if (child.exitCode !== null || child.signalCode !== null) return
	try {
		child.send('stop')
	} catch {}
	await Promise.race([
		new Promise((resolve) => child.once('exit', resolve)),
		new Promise((resolve) => setTimeout(resolve, 1500)),
	])
	if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}
async function live(mode) {
	const agentPort = await freePort()
	const filename = join(project, `target.${mode === 'esm' ? 'mjs' : 'cjs'}`)
	const importSdk =
		mode === 'esm'
			? "import { MitoNode } from '@mitojs/node'; import inspector from 'node:inspector';"
			: "const { MitoNode } = require('@mitojs/node'); const inspector = require('node:inspector');"
	await writeFile(
		filename,
		`${importSdk}\n(async()=> { const client = new MitoNode({metrics:{CPU:{interval:100},Memory:{interval:100},JSError:false,Timeout:false}}); await client.start(); const keepAlive = setInterval(()=>Math.sqrt(Math.random()),100); process.on('message',async(message)=>{if(message==='stop'){clearInterval(keepAlive);await client.destroy();process.exit(0)}}); console.log(JSON.stringify({ready:true,pid:process.pid,port:Number(new URL(inspector.url()).port)})); })().catch(error=>{console.error(error);process.exit(1)});\n`
	)
	// Windows 无 SIGUSR1：每个平台均使用显式预开的 Inspector 验证同一安装包调用路径。
	const child = spawn(runtime, ['--inspect=127.0.0.1:0', filename], {
		cwd: project,
		env: { ...process.env, MITO_AGENT_TCP_PORT: String(agentPort) },
		stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
	})
	let stdout = ''
	let stderr = ''
	child.stderr.on('data', (chunk) => {
		stderr += chunk
	})
	let agentPid
	try {
		const ready = await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`Packed ${mode} SDK startup timed out: ${stderr}`)), 12000)
			child.stdout.on('data', (chunk) => {
				stdout += chunk
				for (const line of stdout.split('\n')) {
					try {
						const data = JSON.parse(line)
						if (data.ready) {
							clearTimeout(timer)
							resolve(data)
							return
						}
					} catch {}
				}
			})
			child.once('error', (error) => {
				clearTimeout(timer)
				reject(error)
			})
			child.once('exit', (code) => {
				clearTimeout(timer)
				reject(new Error(`Packed target exited ${code}: ${stderr}`))
			})
		})
		const info = await fetch(`http://127.0.0.1:${agentPort}/info`).then((res) => res.json())
		assert.equal(info.name, 'mitojs-agent')
		assert.equal(info.protocol_version, 1)
		agentPid = info.pid
		const deadline = Date.now() + 5000
		let observed
		while (Date.now() < deadline) {
			observed = await fetch(`http://127.0.0.1:${agentPort}/metrics/${ready.pid}`).then((res) => res.json())
			if (observed?.data?.memory?.memory?.rss > 0) break
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
		assert(observed?.data?.memory?.memory?.rss > 0, 'Packed SDK must upload real memory to its packaged native Agent')
		const common = [
			'-p',
			String(ready.pid),
			'--port',
			String(ready.port),
			'--agent-port',
			String(agentPort),
			'--json',
			'--history-dir',
			join(project, `history-${mode}`),
		]
		const memory = JSON.parse(
			await command(`${mode}: packed CLI reads packed SDK/Agent`, runtime, [
				'node_modules/@mitojs/node-cli/dist/cli.mjs',
				'monitor-memory',
				...common,
			])
		)
		assert.equal(memory.success, true)
		assert.equal(memory.data.source, 'agent')
		assert(memory.data.rss > 0)
		const falsy = JSON.parse(
			await command(`${mode}: packed CLI Inspector returns zero`, runtime, [
				'node_modules/@mitojs/node-cli/dist/cli.mjs',
				'run-code',
				'--code',
				'0',
				...common,
			])
		)
		assert.equal(falsy.success, true)
		assert.equal(falsy.data, 0)
		checked(`${mode}: live installed SDK + native Agent + CLI`, {
			pid: ready.pid,
			agentPid,
			agentPort,
			inspectorPort: ready.port,
			memorySource: memory.data.source,
			rss: memory.data.rss,
			zeroResult: falsy.data,
		})
	} finally {
		await stop(child)
		if (agentPid && agentPid !== process.pid && agentPid !== child.pid) {
			try {
				process.kill(agentPid, 'SIGTERM')
			} catch {}
		}
		report.commands.push({ name: `${mode}: packed target`, stdout, stderr })
	}
}
try {
	await mkdir(project)
	await mkdir(tarballs)
	report.runtime = {
		executable: runtime,
		version: (await command('consumer Node runtime version', runtime, ['--version'])).trim(),
	}
	await writeFile(
		join(project, 'package.json'),
		JSON.stringify({
			name: 'mito-packed-smoke',
			version: '0.0.0',
			private: true,
			type: 'module',
			packageManager: 'pnpm@10.33.0',
		})
	)
	for (const name of ['@mitojs/node-shared', '@mitojs/node', '@mitojs/node-cli'])
		await pnpm(`pack ${name}`, ['--filter', name, 'pack', '--pack-destination', tarballs])
	const archives = (await readdir(tarballs)).filter((name) => name.endsWith('.tgz')).sort()
	assert.equal(archives.length, 3)
	for (const name of archives)
		report.packages.push({
			filename: name,
			sha256: createHash('sha256')
				.update(await readFile(join(tarballs, name)))
				.digest('hex'),
		})
	const npmCandidates = [
		join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
		resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
	]
	let npmCli
	for (const candidate of npmCandidates) {
		try {
			await access(candidate)
			npmCli = candidate
			break
		} catch {}
	}
	assert(npmCli, 'The Node installation must include npm for an independent clean consumer install')
	await command(
		'install actual workspace tarballs in clean directory',
		process.execPath,
		[
			npmCli,
			'install',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			'--package-lock=false',
			...archives.map((name) => join(tarballs, name)),
		],
		project
	)
	for (const name of ['@mitojs/node-shared', '@mitojs/node', '@mitojs/node-cli']) {
		const pkg = JSON.parse(await readFile(join(project, 'node_modules', name, 'package.json'), 'utf8'))
		assert(
			Object.values({
				...pkg.dependencies,
				...pkg.devDependencies,
				...pkg.peerDependencies,
				...pkg.optionalDependencies,
			}).every((version) => !String(version).startsWith('workspace:')),
			`${name} tarball retains a workspace reference`
		)
		checked(`${name}: tarball dependencies are publishable`, {
			version: pkg.version,
			main: pkg.main,
			types: pkg.types,
			bin: pkg.bin,
		})
	}
	await command('ESM imports from installed tarballs', runtime, [
		'--input-type=module',
		'--eval',
		"import assert from 'node:assert/strict';import {MitoNode} from '@mitojs/node';import {executeDiagnostic,HistoryStore} from '@mitojs/node-cli';import {SubjectNames} from '@mitojs/node-shared/constants';import {collectMemoryMetrics} from '@mitojs/node-shared/recipes';assert.equal(typeof MitoNode,'function');assert.equal(typeof executeDiagnostic,'function');assert.equal(typeof HistoryStore,'function');assert.equal(SubjectNames.CPU,'CPU');assert(collectMemoryMetrics().memory.rss>0);console.log('ESM imports passed')",
	])
	checked('ESM installed imports', ['SDK', 'CLI', 'shared/constants', 'shared/recipes'])
	await command('CJS requires from installed tarballs', runtime, [
		'--input-type=commonjs',
		'--eval',
		"const assert=require('node:assert/strict');const {MitoNode}=require('@mitojs/node');const {executeDiagnostic,HistoryStore}=require('@mitojs/node-cli');const {SubjectNames}=require('@mitojs/node-shared/constants');const {collectMemoryMetrics}=require('@mitojs/node-shared/recipes');assert.equal(typeof MitoNode,'function');assert.equal(typeof executeDiagnostic,'function');assert.equal(typeof HistoryStore,'function');assert.equal(SubjectNames.CPU,'CPU');assert(collectMemoryMetrics().memory.rss>0);console.log('CJS requires passed')",
	])
	checked('CJS installed requires', ['SDK', 'CLI', 'shared/constants', 'shared/recipes'])
	const help = await command('installed CLI --help', runtime, ['node_modules/@mitojs/node-cli/dist/cli.mjs', '--help'])
	assert(help.includes('diagnose') && help.includes('history') && help.includes('--interactive'))
	checked('CLI executable help', 'diagnose/history/interactive available')
	const shimHelp = await command('installed npm CLI shim --help', process.execPath, [
		npmCli,
		'exec',
		'--offline',
		'--',
		'mito-node',
		'--help',
	])
	assert(shimHelp.includes('diagnose') && shimHelp.includes('history'))
	checked('Installed npm bin shim', 'mito-node --help resolves the installed executable')
	if (!values['skip-live']) {
		await live('esm')
		await live('cjs')
	}
	if (values['pack-destination']) {
		const destination = resolve(values['pack-destination'])
		await mkdir(destination, { recursive: true })
		for (const name of archives) await copyFile(join(tarballs, name), join(destination, name))
		report.packDestination = destination
	}
	report.success = true
} catch (error) {
	report.error = error.stack ?? String(error)
	process.exitCode = 1
} finally {
	report.completedAt = new Date().toISOString()
	if (values.keep) report.retainedDirectory = temporary
	else await rm(temporary, { recursive: true, force: true })
	if (values.output) {
		const path = resolve(values.output)
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
	}
	process.stdout.write(
		`${JSON.stringify({ success: report.success, checks: report.checks, packages: report.packages, error: report.error, report: values.output ? resolve(values.output) : undefined }, null, 2)}\n`
	)
}

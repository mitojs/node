#!/usr/bin/env node
const { spawn, spawnSync } = require('node:child_process')
const { createServer } = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const { setInterval: sampleInterval, clearInterval: cancelInterval } = require('node:timers')
const { existsSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const path = require('node:path')
const os = require('node:os')
const { performance } = require('node:perf_hooks')
const root = path.resolve(__dirname, '..')
const MiB = 1024 * 1024

function summarize(samples) {
	if (!samples.length || samples.some((value) => !Number.isFinite(value)))
		throw new Error('Finite samples are required')
	const sorted = [...samples].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return {
		count: samples.length,
		mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
		median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
		min: sorted[0],
		max: sorted.at(-1),
	}
}
function parse(argv) {
	const result = {}
	for (let index = 0; index < argv.length; index += 2) result[argv[index].replace(/^--/, '')] = argv[index + 1]
	return result
}
function agentRss(pid) {
	if (!pid || process.platform === 'win32') return null
	const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' })
	const KiB = Number(result.stdout.trim())
	return result.status === 0 && Number.isFinite(KiB) ? KiB * 1024 : null
}
async function freePort() {
	const server = createServer()
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = server.address().port
	await new Promise((resolve) => server.close(resolve))
	return port
}
async function sample(args) {
	const sdkRoot = path.resolve(args.sdk || path.join(root, 'packages/node/dist'))
	let client,
		daemonPid,
		checksum = 0
	const retained = []
	function workload() {
		let value = 0
		for (let n = 1; n <= 20000; n++) value += Math.sqrt(n) * Math.sin(n)
		checksum += value
		retained.push(Buffer.alloc(4096, 7))
		if (retained.length > 64) retained.shift()
		if (args.scenario === 'timer-churn')
			for (let n = 0; n < 10; n++) {
				const timer = setTimeout(() => {}, 60000)
				clearTimeout(timer)
			}
	}
	async function phase(milliseconds) {
		const started = performance.now()
		const ticks = Math.ceil(milliseconds / 10)
		for (let tick = 0; tick < ticks; tick++) {
			workload()
			const wait = (tick + 1) * 10 - (performance.now() - started)
			if (wait > 0) await delay(wait)
		}
		return ticks
	}
	try {
		if (args.worker === 'sdk') {
			const { MitoNode } = require(sdkRoot)
			client = new MitoNode()
			await client.start()
			// 复用 SDK 自身的 HTTP 客户端，避免基准工具仅在 SDK 组加载 Undici 干扰 RSS。
			const { requestToAgent } = require(path.join(sdkRoot, 'request'))
			const info = await requestToAgent('/info')
			daemonPid = info.pid
		}
		await phase(Number(args['warmup-ms']))
		global.gc?.()
		const before = process.memoryUsage(),
			agentBefore = agentRss(daemonPid),
			memorySamples = [before]
		const sampler = sampleInterval(() => memorySamples.push(process.memoryUsage()), 50)
		const cpuBefore = process.cpuUsage(),
			timeBefore = performance.now()
		const measuredTicks = await phase(Number(args['duration-ms']))
		const elapsedMs = performance.now() - timeBefore,
			cpu = process.cpuUsage(cpuBefore)
		cancelInterval(sampler)
		global.gc?.()
		const afterGc = process.memoryUsage(),
			agentAfter = agentRss(daemonPid)
		return {
			mode: args.worker,
			scenario: args.scenario,
			measuredTicks,
			checksum,
			elapsedMs,
			cpu: { userMicros: cpu.user, systemMicros: cpu.system, corePercent: (cpu.user + cpu.system) / (elapsedMs * 10) },
			memory: {
				before,
				afterGc,
				meanRssBytes: summarize(memorySamples.map((s) => s.rss)).mean,
				peakRssBytes: Math.max(...memorySamples.map((s) => s.rss)),
				peakHeapUsedBytes: Math.max(...memorySamples.map((s) => s.heapUsed)),
			},
			agent: { pid: daemonPid ?? null, rssBeforeBytes: agentBefore, rssAfterBytes: agentAfter },
			memorySamples,
		}
	} finally {
		await client?.destroy()
		// 每个样本使用随机隔离端口，仅清理本次确认属于自己的 daemon。
		if (daemonPid)
			try {
				process.kill(daemonPid)
			} catch {}
	}
}
async function child(options, mode, scenario) {
	const port = await freePort()
	const processHandle = spawn(
		process.execPath,
		[
			'--expose-gc',
			__filename,
			'--worker',
			mode,
			'--scenario',
			scenario,
			'--sdk',
			options.sdk,
			'--warmup-ms',
			String(options.warmupMs),
			'--duration-ms',
			String(options.durationMs),
		],
		{
			env: { ...process.env, MITO_AGENT_TCP_PORT: String(port), MITO_AGENT_BINARY_PATH: options.binary },
			stdio: ['ignore', 'pipe', 'pipe'],
		}
	)
	let stdout = '',
		stderr = ''
	processHandle.stdout.on('data', (data) => {
		stdout += data
	})
	processHandle.stderr.on('data', (data) => {
		stderr += data
	})
	const code = await new Promise((resolve, reject) => {
		processHandle.once('error', reject)
		processHandle.once('exit', resolve)
	})
	if (code !== 0) throw new Error(`Benchmark ${mode}/${scenario} exited ${code}: ${stderr}`)
	return JSON.parse(stdout)
}
async function benchmark(args) {
	const sdkRoot = path.resolve(args.sdk || path.join(root, 'packages/node/dist'))
	const { getPlatformInfo } = require(path.join(sdkRoot, 'binary'))
	const options = {
		sdk: sdkRoot,
		runs: Number(args.runs || 3),
		warmupMs: Number(args['warmup-ms'] || 1000),
		durationMs: Number(args['duration-ms'] || 6000),
		binary: path.resolve(
			args.binary ||
				process.env.MITO_AGENT_BINARY_PATH ||
				path.join(root, 'packages/node/binaries', getPlatformInfo().binaryName)
		),
		output: path.resolve(args.output || path.join(root, 'docs/reports/implementation/benchmark-sdk.json')),
	}
	if (!Number.isInteger(options.runs) || options.runs < 3 || options.warmupMs < 1000 || options.durationMs < 6000)
		throw new Error('Use at least 3 runs, 1000ms warmup and 6000ms measurement (includes default 5s collection)')
	if (!existsSync(options.binary)) throw new Error(`Build Agent binary first: ${options.binary}`)
	const raw = []
	for (const scenario of ['compute-memory', 'timer-churn'])
		for (let repeat = 0; repeat < options.runs; repeat++) {
			// 交替运行次序，减轻预热与共享机器负载对某一种模式的系统偏差。
			for (const mode of repeat % 2 ? ['sdk', 'baseline'] : ['baseline', 'sdk']) {
				process.stderr.write(`Benchmark ${scenario} ${repeat + 1}/${options.runs} ${mode}\n`)
				raw.push({ repeat, ...(await child(options, mode, scenario)) })
			}
		}
	const comparisons = []
	for (const scenario of ['compute-memory', 'timer-churn']) {
		const base = raw.filter((s) => s.scenario === scenario && s.mode === 'baseline'),
			sdk = raw.filter((s) => s.scenario === scenario && s.mode === 'sdk')
		const paired = base.map((b) => {
			const s = sdk.find((s) => s.repeat === b.repeat)
			if (b.measuredTicks !== s.measuredTicks || b.checksum !== s.checksum) throw new Error('Paired workload mismatch')
			return {
				repeat: b.repeat,
				cpuCorePercentPoints: s.cpu.corePercent - b.cpu.corePercent,
				meanRssMiB: (s.memory.meanRssBytes - b.memory.meanRssBytes) / MiB,
				heapAfterGcMiB: (s.memory.afterGc.heapUsed - b.memory.afterGc.heapUsed) / MiB,
			}
		})
		comparisons.push({
			scenario,
			baselineCpuCorePercent: summarize(base.map((s) => s.cpu.corePercent)),
			sdkCpuCorePercent: summarize(sdk.map((s) => s.cpu.corePercent)),
			cpuCorePercentPointOverhead: summarize(paired.map((s) => s.cpuCorePercentPoints)),
			rssMiBOverhead: summarize(paired.map((s) => s.meanRssMiB)),
			heapAfterGcMiBOverhead: summarize(paired.map((s) => s.heapAfterGcMiB)),
			agentRssMiB: summarize(sdk.map((s) => s.agent.rssAfterBytes / MiB)),
			paired,
		})
	}
	const report = {
		generatedAt: new Date().toISOString(),
		environment: {
			platform: process.platform,
			arch: process.arch,
			node: process.version,
			cpu: os.cpus()[0]?.model,
			logicalCpuCount: os.cpus().length,
		},
		options,
		artifacts: Object.fromEntries(
			[
				options.binary,
				path.join(options.sdk, 'shared/ReactiveSubject.js'),
				path.join(options.sdk, 'collector/timeout.js'),
				__filename,
			].map((file) => [path.relative(root, file), createHash('sha256').update(readFileSync(file)).digest('hex')])
		),
		methodology:
			'Fresh --expose-gc Node child per sample; Agent identity uses existing SDK HTTP, never SDK-only fetch initialization; matched fixed work and checksum; >=1s warmup + >=6s measurement; default collectors; 50ms memory sampling; alternating paired order. Agent RSS counted separately. Shared host load uncontrolled; descriptive results, no performance guarantee.',
		comparisons,
		raw,
	}
	mkdirSync(path.dirname(options.output), { recursive: true })
	writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n')
	const rows = comparisons
		.map(
			(c) =>
				`| ${c.scenario} | ${c.baselineCpuCorePercent.median.toFixed(2)}% | ${c.sdkCpuCorePercent.median.toFixed(2)}% | ${c.cpuCorePercentPointOverhead.median.toFixed(2)} pp | ${c.rssMiBOverhead.median.toFixed(2)} MiB | ${c.heapAfterGcMiBOverhead.median.toFixed(2)} MiB | ${c.agentRssMiB.median.toFixed(2)} MiB |`
		)
		.join('\n')
	writeFileSync(
		options.output.replace(/\.json$/, '.md'),
		`# SDK 开销基准\n\n${report.generatedAt}；${report.environment.platform}/${report.environment.arch}，Node ${report.environment.node}，${report.environment.cpu}。\n\n每场景 ${options.runs} 组配对；预热 ${options.warmupMs}ms，计量 ${options.durationMs}ms。相同固定工作量与 checksum，两种模式均手动 GC；默认 SDK 配置；每 50ms 记录 RSS/heap。compute-memory 每 10ms 执行相同计算和缓冲分配；timer-churn 额外创建并取消 10 个定时器。次序交替，原始样本和环境保存在 JSON。\n\n| 场景 | 基线 CPU 中位数 | SDK CPU 中位数 | CPU 配对增量中位数 | Node RSS 增量中位数 | GC 后 heap 增量中位数 | Agent RSS 中位数（另计） |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows}\n\nCPU 为单核百分比，pp 为百分点；RSS 为测量窗均值配对差，heap 为测量后 GC 配对差。Agent 必须另计。共享开发机器存在其他负载，短样本噪声可能造成负差值；不据此承诺固定开销上限。\n\n复现：\`node scripts/benchmark-sdk.cjs --runs ${options.runs} --warmup-ms ${options.warmupMs} --duration-ms ${options.durationMs}\`。先构建 SDK 和当前平台 Agent。\n`
	)
	process.stdout.write(JSON.stringify({ output: options.output, comparisons }, null, 2) + '\n')
}
module.exports = { summarize }
if (require.main === module) {
	const args = parse(process.argv.slice(2))
	;(args.worker
		? sample(args).then((result) => process.stdout.write(JSON.stringify(result) + '\n'))
		: benchmark(args)
	).catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
}

/**
 * E2E 集成测试：验证 SDK → Agent → CLI 完整链路
 *
 * 注意：此测试需要预先构建 SDK 和 CLI 包（pnpm build）。
 * 由于需要启动真实 Agent 进程，测试超时时间设置较长。
 */
import { type ChildProcess, execSync, spawn } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../../..')
const CLI_BIN = path.resolve(ROOT, 'packages/node-cli/dist/cli.mjs')
const SDK_DEMO = path.resolve(ROOT, 'demos/sdk_with_cli.mjs')

describe('E2E: SDK → Agent → CLI', () => {
	let demoProcess: ChildProcess | null = null

	afterEach(() => {
		if (demoProcess && !demoProcess.killed) {
			demoProcess.kill('SIGTERM')
			demoProcess = null
		}
	})

	it('should get memory data via CLI from a process with SDK loaded', async () => {
		// 启动 SDK demo 进程
		demoProcess = spawn('node', [SDK_DEMO], {
			cwd: ROOT,
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		// 等待 SDK 初始化完成
		const pid = await new Promise<number>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('SDK init timeout')), 15000)
			let output = ''
			demoProcess!.stdout!.on('data', (chunk) => {
				output += chunk.toString()
				const pidMatch = output.match(/PID: (\d+)/)
				if (pidMatch && output.includes('SDK started')) {
					clearTimeout(timeout)
					resolve(parseInt(pidMatch[1]))
				}
			})
			demoProcess!.on('error', (e) => {
				clearTimeout(timeout)
				reject(e)
			})
		})

		// 额外等待让 Agent 和 metrics 至少推送一次
		await new Promise((r) => setTimeout(r, 6000))

		// 使用 CLI 查询 memory
		const cliOutput = execSync(`node ${CLI_BIN} memory -p ${pid} --json`, {
			encoding: 'utf8',
			timeout: 10000,
			cwd: ROOT,
		}).trim()

		const result = JSON.parse(cliOutput)
		expect(result.success).toBe(true)
		expect(result.command).toBe('memory')
		expect(result.data).toBeDefined()
		expect(result.data.source).toMatch(/^(agent|inspector)$/)
	}, 30000)

	it('should get CPU data via monitor-cpu from a running process', async () => {
		demoProcess = spawn('node', [SDK_DEMO], {
			cwd: ROOT,
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		const pid = await new Promise<number>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('SDK init timeout')), 15000)
			let output = ''
			demoProcess!.stdout!.on('data', (chunk) => {
				output += chunk.toString()
				const pidMatch = output.match(/PID: (\d+)/)
				if (pidMatch && output.includes('SDK started')) {
					clearTimeout(timeout)
					resolve(parseInt(pidMatch[1]))
				}
			})
			demoProcess!.on('error', (e) => {
				clearTimeout(timeout)
				reject(e)
			})
		})

		await new Promise((r) => setTimeout(r, 6000))

		// monitor-cpu 在 --json 模式下输出 NDJSON 流，取第一行即可
		const cliProcess = spawn('node', [CLI_BIN, 'monitor-cpu', '-p', String(pid), '--json'], {
			cwd: ROOT,
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		const firstLine = await new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => {
				cliProcess.kill()
				reject(new Error('monitor-cpu timeout'))
			}, 10000)
			let buffer = ''
			cliProcess.stdout!.on('data', (chunk) => {
				buffer += chunk.toString()
				const lines = buffer.split('\n')
				if (lines.length > 1) {
					clearTimeout(timeout)
					cliProcess.kill()
					resolve(lines[0])
				}
			})
		})

		const result = JSON.parse(firstLine)
		expect(result.success).toBe(true)
		expect(result.command).toBe('monitor-cpu')
		expect(result.data.cpuPercent).toBeGreaterThanOrEqual(0)
	}, 30000)
})

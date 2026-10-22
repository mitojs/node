import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { join } from 'node:path'
import { configMap } from './config'
import { IpcMessageCode } from './shared'
import type { IpcMessage } from './types'

/**
 * 平台和架构映射
 */
interface PlatformInfo {
	platform: string
	arch: string
	binaryName: string
}

/**
 * 获取当前平台信息
 */
export function getPlatformInfo(): PlatformInfo {
	const currentPlatform = platform()
	const currentArch = arch()

	let binaryName: string

	switch (currentPlatform) {
		case 'win32':
			// 二进制文件名使用 win 而非 win32，与 binaries/ 目录中实际文件名一致
			binaryName = 'mitojs-agent-win-x64.exe'
			break
		case 'darwin':
			binaryName = currentArch === 'arm64' ? 'mitojs-agent-darwin-arm64' : 'mitojs-agent-darwin-x64'
			break
		case 'linux':
			binaryName = currentArch === 'arm64' ? 'mitojs-agent-linux-arm64-musl' : 'mitojs-agent-linux-x64-musl'
			break
		default:
			throw new Error(`不支持的平台: ${currentPlatform}-${currentArch}`)
	}

	return {
		platform: currentPlatform,
		arch: currentArch,
		binaryName,
	}
}

/**
 * 获取二进制文件路径
 */
function getBinaryPath(): string {
	const platformInfo = getPlatformInfo()
	const binaryPath = join(__dirname, '..', 'binaries', platformInfo.binaryName)

	if (!existsSync(binaryPath)) {
		throw new Error(
			`未找到对应平台的二进制文件: ${platformInfo.binaryName}\n` +
				`期望路径: ${binaryPath}\n` +
				`当前平台: ${platformInfo.platform}-${platformInfo.arch}`
		)
	}

	return binaryPath
}

/** 启动前校验已有端口的身份，避免将任意本地 HTTP 服务误认为 Agent。 */
async function hasCompatibleAgent(): Promise<boolean> {
	try {
		const { easyFetch } = await import('./shared/utils')
		const response = await easyFetch(`http://127.0.0.1:${configMap.get('agentTCPPort')}/info`, { timeout: 1000 })
		const info = await response.json()
		if (
			response.status !== 200 ||
			info.name !== 'mitojs-agent' ||
			info.protocol_version !== 1 ||
			info.status !== 'running' ||
			!Number.isInteger(info.pid) ||
			info.pid <= 0
		) {
			throw new Error('Agent port has an incompatible service identity or protocol')
		}
		return true
	} catch (error) {
		if ((error as Error).message.includes('ECONNREFUSED')) return false
		throw error
	}
}

export class MitojsAgent {
	private process: ChildProcess | null = null
	private starting: Promise<void> | null = null

	// start 成功表示经过 /info 协议校验，已存在的 daemon 由其自身生命周期管理。
	start(args: string[] = [], timeoutMs = 5000): Promise<void> {
		if (this.starting) return this.starting
		if (this.process) return Promise.resolve()
		this.starting = this.startOnce(args, timeoutMs).finally(() => {
			this.starting = null
		})
		return this.starting
	}
	private async startOnce(args: string[], timeoutMs: number): Promise<void> {
		if (await hasCompatibleAgent()) return
		const binaryPath = process.env.MITO_AGENT_BINARY_PATH || getBinaryPath()
		if (!existsSync(binaryPath)) throw new Error(`Agent binary does not exist: ${binaryPath}`)
		await new Promise<void>((resolve, reject) => {
			const child = spawn(binaryPath, args, {
				// SDK 自动创建的 daemon 不继承终端，避免污染宿主应用输出。
				stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
				detached: false,
				env: {
					...process.env,
					MITO_AGENT_TCP_PORT: String(configMap.get('agentTCPPort')),
					MITO_AGENT_HOST: '127.0.0.1',
					MITO_AGENT_MANAGED: '1',
				},
			})
			this.process = child
			let settled = false
			let readinessPoll: NodeJS.Timeout | null = null
			let polling = false
			const timer = setTimeout(() => finish(new Error('Agent startup timeout')), timeoutMs)
			const finish = (error?: Error) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				if (readinessPoll) clearInterval(readinessPoll)
				child.off('error', onError)
				child.off('message', onMessage)
				child.off('exit', onEarlyExit)
				if (error) {
					child.kill()
					this.process = null
					reject(error)
				} else {
					child.unref()
					child.channel?.unref()
					resolve()
				}
			}
			const onError = (error: Error) => finish(new Error(`Agent startup failed: ${error.message}`))
			const onEarlyExit = (code: number | null, signal: NodeJS.Signals | null) =>
				finish(new Error(`Agent exited before readiness: ${code ?? signal}`))
			const onMessage = async (message: IpcMessage) => {
				// 竞争绑定失败的子进程会立即退出，先保留验证现有 daemon 的机会。
				if (message.message === 'addr_in_use') child.off('exit', onEarlyExit)
				if (message.code !== IpcMessageCode.Ok && message.message !== 'addr_in_use') {
					finish(new Error(`Agent startup failed: ${message.message}`))
					return
				}
				try {
					const ready = await hasCompatibleAgent()
					if (!ready) {
						finish(new Error('Agent readiness identity check failed'))
						return
					}
					if (message.code !== IpcMessageCode.Ok) {
						child.kill()
						this.process = null
					}
					finish()
				} catch (error) {
					finish(error as Error)
				}
			}
			child.once('error', onError)
			child.on('message', onMessage)
			child.once('exit', onEarlyExit)
			child.once('exit', () => {
				if (this.process === child) this.process = null
			})
			// Windows Rust 无法使用 Node 的 Unix fd3 IPC，改为轮询同一身份协议确认就绪。
			// Unix 继续以 IPC 错误为准，不能用轮询掩盖实际启动错误。
			if (platform() === 'win32') {
				readinessPoll = setInterval(async () => {
					if (polling || settled) return
					polling = true
					try {
						if (await hasCompatibleAgent()) finish()
					} catch (error) {
						finish(error as Error)
					} finally {
						polling = false
					}
				}, 50)
			}
		})
	}
	// 只停止此管理对象自己创建的进程，不终止复用的 daemon。
	async stop(): Promise<void> {
		const child = this.process
		if (!child) return
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => child.kill('SIGKILL'), 1000)
			child.once('exit', () => {
				clearTimeout(timer)
				this.process = null
				resolve()
			})
			child.kill('SIGTERM')
		})
	}
	getPid(): number | undefined {
		return this.process?.pid
	}
	isRunning(): boolean {
		return this.process !== null
	}
}
export function createAgent(): MitojsAgent {
	return new MitojsAgent()
}
export async function initAgent(): Promise<MitojsAgent> {
	const agent = new MitojsAgent()
	await agent.start()
	return agent
}

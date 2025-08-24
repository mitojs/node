import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { join } from 'node:path'
import { configMap } from './config'
import { logger } from './shared'

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
function getPlatformInfo(): PlatformInfo {
	const currentPlatform = platform()
	const currentArch = arch()

	let binaryName: string

	switch (currentPlatform) {
		case 'win32':
			binaryName = 'mitojs-agent-win32-x64.exe'
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

/**
 * Agent 进程管理类
 */
export class MitojsAgent {
	private process: ChildProcess | null = null
	private binaryPath: string

	constructor() {
		this.binaryPath = getBinaryPath()
	}

	/**
	 * 启动 Agent 进程
	 */
	start(args: string[] = []): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.process) {
				reject(new Error('Agent 进程已经在运行中'))
				return
			}
			logger.info(
				`调用 Rust Binary 启动 Agent 进程，二进制路径: ${this.binaryPath}${args.length > 0 ? ` args: ${args.join('')}` : ''}`
			)
			this.process = spawn(this.binaryPath, args, {
				// [0 = stdin（标准输入）,1 = stdout（标准输出）,2 = stderr（标准错误）,3 = 额外的文件描述符，通常用于 IPC]
				// todo 线上用 ['ignore', 'ignore', 'ignore', 'ipc']
				stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
				// todo 通过环境变量控制，本地调试时 detached：false，线上改为 true
				detached: false,
				env: {
					...process.env,
					// 通过环境变量传递配置
					MITO_AGENT_TCP_PORT: configMap.get('agentTCPPort').toString(),
				},
			})

			this.process.on('error', (error) => {
				reject(new Error(`启动 Agent 失败: ${error.message}`))
			})

			this.process.on('message', (message) => {
				console.log(message)
				console.log(`Agent on message`)
			})

			this.process.on('spawn', () => {
				logger.info('Agent 进程启动成功')
				resolve()
			})

			this.process.on('exit', (code, signal) => {
				console.log(`Agent 进程退出，代码: ${code}, 信号: ${signal}`)
				this.process = null
			})

			// 处理输出
			this.process.stdout?.on('data', (data) => {
				// console.log(`[Agent]: ${data.toString().trim()}`)
			})

			this.process.stderr?.on('data', (data) => {
				// console.error(`[Agent Error]: ${data.toString().trim()}`)
			})
		})
	}

	/**
	 * 停止 Agent 进程
	 */
	stop(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.process) {
				resolve()
				return
			}

			this.process.on('exit', () => {
				this.process = null
				resolve()
			})

			// 尝试优雅关闭
			this.process.kill('SIGTERM')

			// 5秒后强制关闭
			setTimeout(() => {
				if (this.process) {
					this.process.kill('SIGKILL')
				}
			}, 5000)
		})
	}

	/**
	 * 检查进程是否在运行
	 */
	isRunning(): boolean {
		return this.process !== null && !this.process.killed
	}

	/**
	 * 获取进程 PID
	 */
	getPid(): number | undefined {
		return this.process?.pid
	}
}

/**
 * 创建 Agent 实例
 */
export function initAgent(): MitojsAgent {
	return new MitojsAgent()
}

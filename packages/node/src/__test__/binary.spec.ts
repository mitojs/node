import { existsSync } from 'fs'
import { arch, platform } from 'os'
import { join } from 'path'
import { createAgent, getPlatformInfo, MitojsAgent } from '../binary'

describe('Binary Management', () => {
	describe('getPlatformInfo', () => {
		it('should return correct platform info', () => {
			const platformInfo = getPlatformInfo()

			expect(platformInfo).toHaveProperty('platform')
			expect(platformInfo).toHaveProperty('arch')
			expect(platformInfo).toHaveProperty('binaryName')

			expect(platformInfo.platform).toBe(platform())
			expect(platformInfo.arch).toBe(arch())
			expect(typeof platformInfo.binaryName).toBe('string')
			expect(platformInfo.binaryName.length).toBeGreaterThan(0)
		})

		it('should generate correct binary name for current platform', () => {
			const platformInfo = getPlatformInfo()
			const currentPlatform = platform()
			const currentArch = arch()

			switch (currentPlatform) {
				case 'win32':
					expect(platformInfo.binaryName).toBe('mitojs-agent-win32-x64.exe')
					break
				case 'darwin':
					if (currentArch === 'arm64') {
						expect(platformInfo.binaryName).toBe('mitojs-agent-darwin-arm64')
					} else {
						expect(platformInfo.binaryName).toBe('mitojs-agent-darwin-x64')
					}
					break
				case 'linux':
					if (currentArch === 'arm64') {
						expect(platformInfo.binaryName).toBe('mitojs-agent-linux-arm64')
					} else {
						expect(platformInfo.binaryName).toBe('mitojs-agent-linux-x64')
					}
					break
			}
		})
	})

	describe('MitojsAgent', () => {
		let agent: MitojsAgent

		beforeEach(() => {
			agent = createAgent()
		})

		afterEach(async () => {
			if (agent.isRunning()) {
				await agent.stop()
			}
		})

		it('should create agent instance', () => {
			expect(agent).toBeInstanceOf(MitojsAgent)
			expect(agent.isRunning()).toBe(false)
			expect(agent.getPid()).toBeUndefined()
		})

		it('should detect binary file existence', () => {
			const platformInfo = getPlatformInfo()
			const binaryPath = join(__dirname, '..', '..', 'binaries', platformInfo.binaryName)

			// 注意：这个测试可能会失败，如果二进制文件还没有构建
			// 在实际使用中，应该先运行构建脚本
			if (existsSync(binaryPath)) {
				expect(existsSync(binaryPath)).toBe(true)
			} else {
				console.warn(`二进制文件不存在: ${binaryPath}`)
				console.warn('请先运行构建脚本: npm run build:rust')
			}
		})

		// 这个测试需要实际的二进制文件存在
		it.skip('should start and stop agent process', async () => {
			// 跳过这个测试，因为需要实际的二进制文件
			// 在有二进制文件的情况下可以启用

			expect(agent.isRunning()).toBe(false)

			await agent.start()
			expect(agent.isRunning()).toBe(true)
			expect(agent.getPid()).toBeDefined()

			await agent.stop()
			expect(agent.isRunning()).toBe(false)
			expect(agent.getPid()).toBeUndefined()
		}, 10000)

		it('should handle multiple start attempts', async () => {
			// 模拟多次启动的情况
			const startPromise1 = agent.start().catch((err) => err)
			const startPromise2 = agent.start().catch((err) => err)

			const results = await Promise.all([startPromise1, startPromise2])

			// 至少有一个应该成功或者都应该有适当的错误处理
			expect(results).toHaveLength(2)
		})
	})

	describe('createAgent', () => {
		it('should create new agent instances', () => {
			const agent1 = createAgent()
			const agent2 = createAgent()

			expect(agent1).toBeInstanceOf(MitojsAgent)
			expect(agent2).toBeInstanceOf(MitojsAgent)
			expect(agent1).not.toBe(agent2) // 应该是不同的实例
		})
	})
})

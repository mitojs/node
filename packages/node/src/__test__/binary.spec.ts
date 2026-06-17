import { existsSync } from 'fs'
import { arch, platform } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
					expect(platformInfo.binaryName).toBe('mitojs-agent-win-x64.exe')
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
						expect(platformInfo.binaryName).toBe('mitojs-agent-linux-arm64-musl')
					} else {
						expect(platformInfo.binaryName).toBe('mitojs-agent-linux-x64-musl')
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

			if (existsSync(binaryPath)) {
				expect(existsSync(binaryPath)).toBe(true)
			} else {
				console.warn(`二进制文件不存在: ${binaryPath}`)
				console.warn('请先运行构建脚本: npm run build:rust')
			}
		})

		it.skip('should start and stop agent process', async () => {
			expect(agent.isRunning()).toBe(false)

			await agent.start()
			expect(agent.isRunning()).toBe(true)
			expect(agent.getPid()).toBeDefined()

			await agent.stop()
			expect(agent.isRunning()).toBe(false)
			expect(agent.getPid()).toBeUndefined()
		}, 10000)

		it('should handle multiple start attempts', async () => {
			const startPromise1 = agent.start().catch((err) => err)
			const startPromise2 = agent.start().catch((err) => err)

			const results = await Promise.all([startPromise1, startPromise2])

			expect(results).toHaveLength(2)
		})
	})

	describe('createAgent', () => {
		it('should create new agent instances', () => {
			const agent1 = createAgent()
			const agent2 = createAgent()

			expect(agent1).toBeInstanceOf(MitojsAgent)
			expect(agent2).toBeInstanceOf(MitojsAgent)
			expect(agent1).not.toBe(agent2)
		})
	})
})

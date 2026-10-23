import { createServer } from 'node:net'
import { arch, platform } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createAgent, getPlatformInfo } from '../binary'
import { configMap } from '../config'
import { requestToAgent } from '../request'

describe('platform binary integration', () => {
	it('selects the packaged filename for this operating system and architecture', () => {
		const expected: Record<string, string> = {
			'darwin-arm64': 'mitojs-agent-darwin-arm64',
			'darwin-x64': 'mitojs-agent-darwin-x64',
			'linux-arm64': 'mitojs-agent-linux-arm64-musl',
			'linux-x64': 'mitojs-agent-linux-x64-musl',
			'win32-x64': 'mitojs-agent-win-x64.exe',
		}
		expect(getPlatformInfo()).toEqual({
			platform: platform(),
			arch: arch(),
			binaryName: expected[`${platform()}-${arch()}`],
		})
	})
	it('starts the current platform binary, verifies identity, and stops its own child', async () => {
		const reservation = createServer()
		await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r))
		const port = (reservation.address() as { port: number }).port
		await new Promise<void>((r) => reservation.close(() => r()))
		configMap.update({ agentHost: '127.0.0.1', agentTCPPort: port })
		const agent = createAgent()
		try {
			await Promise.all([agent.start(), agent.start()])
			const info = await requestToAgent<{ pid: number; name: string; protocol_version: number }>('/info')
			expect(info.pid).toBe(agent.getPid())
			expect(info.name).toBe('mitojs-agent')
			expect(info.protocol_version).toBe(1)
			expect(agent.isRunning()).toBe(true)
		} finally {
			await agent.stop()
		}
		expect(agent.isRunning()).toBe(false)
		await expect(requestToAgent('/info')).rejects.toThrow('ECONNREFUSED')
	}, 10000)
})

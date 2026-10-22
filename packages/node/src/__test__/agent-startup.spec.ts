import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import * as osModule from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initAgent, MitojsAgent } from '../binary'
import { configMap } from '../config'

vi.mock('node:os', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:os')>()),
	platform: vi.fn(() => process.platform),
}))
let server: Server | undefined
let dir: string | undefined
let agent: MitojsAgent | undefined
async function endpoint(info: unknown) {
	server = createServer((_req, res) => {
		res.writeHead(200, { 'content-type': 'application/json' })
		res.end(JSON.stringify(info))
	})
	await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
	configMap.update({ agentHost: '127.0.0.1', agentTCPPort: (server.address() as { port: number }).port })
}
function fixture(source: string) {
	dir = mkdtempSync(join(tmpdir(), 'mito-agent-startup-'))
	const file = join(dir, 'fixture-agent')
	writeFileSync(file, `#!${process.execPath}\n${source}`)
	chmodSync(file, 0o755)
	process.env.MITO_AGENT_BINARY_PATH = file
}
afterEach(async () => {
	await agent?.stop()
	agent = undefined
	if (server) {
		await new Promise<void>((resolve) => server!.close(() => resolve()))
		server = undefined
	}
	if (dir) {
		rmSync(dir, { recursive: true, force: true })
		dir = undefined
	}
	vi.mocked(osModule.platform).mockReturnValue(process.platform)
	delete process.env.MITO_AGENT_BINARY_PATH
})
describe('verified local Agent startup', () => {
	it('reuses a daemon only after validating identity and protocol', async () => {
		await endpoint({ name: 'mitojs-agent', version: '0.1.0', status: 'running', protocol_version: 1, pid: 4321 })
		process.env.MITO_AGENT_BINARY_PATH = '/missing-binary-should-not-be-used'
		await expect(initAgent()).resolves.toBeInstanceOf(MitojsAgent)
	})
	it('rejects a different service occupying the Agent port', async () => {
		await endpoint({ name: 'other-service', protocol_version: 1, pid: 4321 })
		await expect(initAgent()).rejects.toThrow(/identity|protocol|compatible/i)
	})
	it('rejects an incompatible protocol occupying the Agent port', async () => {
		await endpoint({ name: 'mitojs-agent', status: 'running', protocol_version: 999, pid: 4321 })
		await expect(initAgent()).rejects.toThrow(/protocol|compatible/i)
	})
	it('rejects startup IPC errors instead of treating them as readiness', async () => {
		configMap.update({ agentHost: '127.0.0.1', agentTCPPort: 61341 })
		fixture("process.send({code:500,message:'permission_denied'});setInterval(()=>{},1000)")
		agent = new MitojsAgent()
		await expect(agent.start()).rejects.toThrow(/permission_denied|startup/i)
	})
	it('verifies HTTP readiness on Windows where Rust cannot write Node IPC fd3', async () => {
		const reservation = createServer()
		await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve))
		const port = (reservation.address() as { port: number }).port
		await new Promise<void>((resolve) => reservation.close(() => resolve()))
		configMap.update({ agentHost: '127.0.0.1', agentTCPPort: port })
		fixture(
			"require('node:http').createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({name:'mitojs-agent',version:'0.1.0',status:'running',protocol_version:1,pid:process.pid}))}).listen(Number(process.env.MITO_AGENT_TCP_PORT),'127.0.0.1')"
		)
		vi.mocked(osModule.platform).mockReturnValue('win32')
		agent = new MitojsAgent()
		// 本例验证 HTTP 就绪协议而非启动速度；使用生产默认预算，避免并行负载下的子进程调度导致误报。
		await expect(agent.start()).resolves.toBeUndefined()
		expect(agent.getPid()).toBeGreaterThan(0)
	})
	it('rejects a child that exits before readiness', async () => {
		configMap.update({ agentHost: '127.0.0.1', agentTCPPort: 61342 })
		fixture('process.exit(7)')
		agent = new MitojsAgent()
		await expect(agent.start()).rejects.toThrow(/7|exit/i)
	})
	it('bounds startup waiting when the child never announces readiness', async () => {
		configMap.update({ agentHost: '127.0.0.1', agentTCPPort: 61343 })
		fixture('setInterval(()=>{},1000)')
		agent = new MitojsAgent()
		await expect(agent.start([], 100)).rejects.toThrow(/timeout/i)
	})
})

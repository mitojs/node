import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { diagnosePlugin } from '../../plugins/diagnose.js'
import { historyPlugin } from '../../plugins/history.js'
import { HistoryStore } from '../../services/history.js'
import { InspectorSession } from '../../services/inspector-session.js'

describe('real Inspector diagnosis and history integration', () => {
	it('captures actual busy frames, memory evidence, explicit missing SDK and reopenable artifacts', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'mito-real-diagnosis-'))
		const target = spawn(
			process.execPath,
			[
				// 固定测试负载为未优化函数，避免短窗口的具名栈帧断言受 V8 热代码归因变化影响。
				'--no-opt',
				'--inspect=127.0.0.1:0',
				'-e',
				`
			let workSink = 0;
			function busyWork() {
				const end = performance.now() + 8;
				// Batch observable JS work so clock/native calls do not dominate the short CPU sample.
				do {
					for (let i = 0; i < 50000; i++) workSink = (Math.imul(workSink ^ i, 1664525) + 1013904223) | 0;
				} while (performance.now() < end);
				globalThis.workSink = workSink;
				setImmediate(busyWork);
			}
			console.log(new URL(require('node:inspector').url()).port);
			busyWork();
		`,
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		)
		let session: InspectorSession | undefined
		try {
			const port = await new Promise<number>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('Target readiness timeout')), 3000)
				target.stdout.once('data', (data) => {
					clearTimeout(timer)
					resolve(Number(String(data).trim()))
				})
				target.once('error', (error) => {
					clearTimeout(timer)
					reject(error)
				})
			})
			session = new InspectorSession({ timeout: 2000 })
			await session.connect(port)
			const ctx = { pid: target.pid as number, port, json: true, session, output: () => {} }
			const result = await diagnosePlugin.execute(ctx, { duration: '200', scenario: 'all', dir: directory })
			expect(result.success).toBe(true)
			expect(result.data.memory.heapUsed.start).toBeGreaterThan(0)
			expect(result.data.memory.heapUsed.end).toBeGreaterThan(0)
			expect(result.data.memory.heapUsed.durationMs).toBeGreaterThanOrEqual(200)
			expect(
				result.data.cpu.hotspots.some(
					(frame: { functionName: string; selfTimeMs: number }) =>
						frame.functionName === 'busyWork' && frame.selfTimeMs > 0
				),
				JSON.stringify(result.data.cpu.hotspots)
			).toBe(true)
			expect(result.data.unavailable).toEqual([
				{ kind: 'timers', error: 'Fresh timer data requires @mitojs/node SDK with Timeout enabled.' },
			])
			expect(result.data.cpu.profileFilename).toContain(directory)
			const rawProfile = JSON.parse(await readFile(result.data.cpu.profileFilename, 'utf8'))
			expect(rawProfile.samples.length).toBeGreaterThan(0)
			const saved = await new HistoryStore({ directory: join(directory, 'history') }).append({
				pid: ctx.pid,
				command: 'diagnose',
				success: result.success,
				result: result.data,
			})
			const reopened = await historyPlugin.execute(ctx, { historyDir: join(directory, 'history'), id: saved.id })
			expect(reopened.data.record.result.cpu.profileFilename).toBe(result.data.cpu.profileFilename)
			const artifacts = await historyPlugin.execute(ctx, { historyDir: join(directory, 'history'), artifacts: true })
			expect(artifacts.data.artifacts[0].path).toBe(result.data.cpu.profileFilename)
		} finally {
			session?.close()
			target.kill('SIGKILL')
			if (target.exitCode === null && target.signalCode === null) await once(target, 'exit')
			await rm(directory, { recursive: true, force: true })
		}
	}, 10000)
})

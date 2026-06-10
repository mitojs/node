import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAnalyze } from '../../analyze/analyze.js'

describe('runAnalyze', () => {
	let outDir: string

	beforeEach(() => {
		outDir = mkdtempSync(join(tmpdir(), 'mito-node-analyze-'))
	})

	afterEach(() => {
		rmSync(outDir, { force: true, recursive: true })
	})

	it('returns partial when one collector fails and another succeeds', async () => {
		const close = jest.fn()
		const result = await runAnalyze(
			{ pid: process.pid, port: 9229, outDir, duration: 10 },
			{
				openSession: jest.fn().mockResolvedValue({
					client: {},
					openedByCli: false,
					close,
				}),
				collectors: {
					memory: jest.fn().mockResolvedValue({ memoryUsage: { rss: 1 } }),
					report: jest.fn().mockRejectedValue(new Error('report unavailable')),
					cpuProfile: jest.fn().mockResolvedValue({ nodes: [] }),
				},
			}
		)

		expect(result.status).toBe('partial')
		expect(result.artifacts.memory.status).toBe('ok')
		expect(result.artifacts.report.status).toBe('failed')
		expect(result.artifacts.cpuProfile.status).toBe('ok')
		expect(result.errors).toContain('report unavailable')
		expect(close).toHaveBeenCalled()
	})

	it('waits for async session cleanup before returning', async () => {
		let cleanedUp = false
		const close = jest.fn().mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0))
			cleanedUp = true
		})

		await runAnalyze(
			{ pid: process.pid, port: 9229, outDir, duration: 0 },
			{
				openSession: jest.fn().mockResolvedValue({
					client: {},
					openedByCli: false,
					close,
				}),
				collectors: {
					memory: jest.fn().mockResolvedValue({ memoryUsage: { rss: 1 } }),
					report: jest.fn().mockResolvedValue({ header: {} }),
					cpuProfile: jest.fn().mockResolvedValue({ nodes: [] }),
				},
			}
		)

		expect(cleanedUp).toBe(true)
	})
})

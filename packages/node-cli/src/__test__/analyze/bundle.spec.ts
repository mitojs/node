import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBundleWriter } from '../../analyze/bundle.js'

describe('createBundleWriter', () => {
	let rootDir: string

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), 'mito-node-bundle-'))
	})

	afterEach(() => {
		rmSync(rootDir, { force: true, recursive: true })
	})

	it('writes artifact files and returns a stable analyze result', () => {
		const writer = createBundleWriter({
			outDir: rootDir,
			pid: 12345,
			startedAt: new Date('2026-06-11T00:00:00.000Z'),
		})

		writer.writeJsonArtifact('memory', 'memory.json', { memoryUsage: { rss: 1 } })
		const result = writer.finalize({
			command: 'node demos/listen_server.mjs',
			duration: 3000,
			warnings: [],
			errors: [],
		})

		expect(result.status).toBe('success')
		expect(result.pid).toBe(12345)
		expect(result.bundleDir).toContain(rootDir)
		expect(result.artifacts.memory.status).toBe('ok')
		expect(result.artifacts.report.status).toBe('skipped')
		expect(result.artifacts.cpuProfile.status).toBe('skipped')
		expect(result.readOrder).toEqual(['summaryMd', 'summaryJson', 'memory'])

		const summary = JSON.parse(readFileSync(result.artifacts.summaryJson.path, 'utf8'))
		expect(summary.status).toBe('success')
		expect(readFileSync(result.artifacts.summaryMd.path, 'utf8')).toContain('PID: 12345')
	})
})

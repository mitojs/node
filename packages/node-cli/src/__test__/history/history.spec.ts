import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractArtifactPaths, HistoryStore, resolveHistoryDirectory } from '../../services/history.js'

const directories: string[] = []
async function directory() {
	const value = await mkdtemp(join(tmpdir(), 'mito-history-test-'))
	directories.push(value)
	return value
}
afterEach(async () => {
	const { rm } = await import('node:fs/promises')
	await Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true })))
})

describe('diagnostic history', () => {
	// Removing the atomic persisted write must break a fresh store's ability to read this result.
	it('persists results across store instances and lists newest first', async () => {
		const dir = await directory()
		const store = new HistoryStore({ directory: dir })
		const first = await store.append({
			pid: 123,
			command: 'monitor-memory',
			success: true,
			result: { heapUsed: 1024, source: 'agent' },
		})
		const second = await store.append({
			pid: 123,
			command: 'monitor-memory',
			success: false,
			result: { error: 'process exited' },
		})
		const reopened = new HistoryStore({ directory: dir })
		expect((await reopened.list()).map((record) => record.id)).toEqual([second.id, first.id])
		expect(await reopened.get(first.id)).toMatchObject({
			pid: 123,
			command: 'monitor-memory',
			success: true,
			dataSource: 'agent',
			result: { heapUsed: 1024 },
		})
		expect(await reopened.get('../outside')).toBeUndefined()
	})

	it('bounds its own records while preserving unrelated files and target artifacts', async () => {
		const dir = await directory()
		const artifact = join(dir, 'capture.cpuprofile')
		await writeFile(artifact, 'profile evidence')
		await writeFile(join(dir, 'notes.json'), '{"keep":true}')
		const store = new HistoryStore({ directory: dir, maxRecords: 2 })
		await store.append({ pid: 123, command: 'cpuprofile', success: true, result: { filename: artifact } })
		await store.append({ command: 'monitor-cpu', pid: 123, success: true, result: { cpuPercent: 20 } })
		await store.append({ command: 'monitor-cpu', pid: 123, success: true, result: { cpuPercent: 30 } })
		expect(await store.list()).toHaveLength(2)
		expect(await readFile(artifact, 'utf8')).toBe('profile evidence')
		expect(await readFile(join(dir, 'notes.json'), 'utf8')).toBe('{"keep":true}')
	})

	it('compares measured fields and artifacts between two records', async () => {
		const store = new HistoryStore({ directory: await directory() })
		const first = await store.append({
			command: 'monitor-memory',
			pid: 123,
			success: true,
			result: { heapUsed: 100, rss: 200 },
			artifacts: ['/tmp/a.cpuprofile'],
		})
		const second = await store.append({
			command: 'monitor-memory',
			pid: 123,
			success: true,
			result: { heapUsed: 150, rss: 180 },
			artifacts: ['/tmp/b.cpuprofile'],
		})
		const comparison = await store.compare(first.id, second.id)
		expect(comparison.deltas).toEqual([
			{ metric: 'heapUsed', before: 100, after: 150, delta: 50, percentChange: 50 },
			{ metric: 'rss', before: 200, after: 180, delta: -20, percentChange: -10 },
		])
		expect(comparison.artifactChanges).toEqual({ added: ['/tmp/b.cpuprofile'], removed: ['/tmp/a.cpuprofile'] })
		expect((await store.artifacts()).map((item) => item.path).sort()).toEqual([
			'/tmp/a.cpuprofile',
			'/tmp/b.cpuprofile',
		])
	})

	it('compares active timer counts while excluding destroyed timers', async () => {
		const store = new HistoryStore({ directory: await directory() })
		const first = await store.append({
			command: 'timers',
			pid: 123,
			success: true,
			result: { timers: [{ id: 1 }, { id: 2, destroyed: true }] },
		})
		const second = await store.append({
			command: 'timers',
			pid: 123,
			success: true,
			result: { timers: [{ id: 1 }, { id: 3 }, { id: 4 }] },
		})
		expect((await store.compare(first.id, second.id)).deltas).toEqual([
			{ metric: 'timers.active', before: 1, after: 3, delta: 2, percentChange: 200 },
		])
	})

	it('matches CPU hotspots by call frame rather than changing rank', async () => {
		const store = new HistoryStore({ directory: await directory() })
		const first = await store.append({
			command: 'diagnose',
			pid: 123,
			success: true,
			result: {
				cpu: {
					hotspots: [
						{ functionName: 'work', url: 'work.js', line: 10, column: 2, selfTimeMs: 20, percent: 20 },
						{ functionName: 'helper', url: 'helper.js', line: 1, column: 1, selfTimeMs: 5, percent: 5 },
					],
				},
			},
		})
		const second = await store.append({
			command: 'diagnose',
			pid: 123,
			success: true,
			result: {
				cpu: {
					hotspots: [
						{ functionName: 'newTask', url: 'new.js', line: 1, column: 1, selfTimeMs: 80, percent: 80 },
						{ functionName: 'work', url: 'work.js', line: 10, column: 2, selfTimeMs: 10, percent: 10 },
					],
				},
			},
		})
		expect((await store.compare(first.id, second.id)).deltas).toEqual([
			{ metric: 'cpu.hotspots["work","work.js",10,2].percent', before: 20, after: 10, delta: -10, percentChange: -50 },
			{
				metric: 'cpu.hotspots["work","work.js",10,2].selfTimeMs',
				before: 20,
				after: 10,
				delta: -10,
				percentChange: -50,
			},
		])
	})

	it('skips corrupt owned records and continues saving valid records', async () => {
		const dir = await directory()
		await writeFile(join(dir, '1000-11111111-1111-4111-8111-111111111111.json'), '{ broken')
		const store = new HistoryStore({ directory: dir })
		const saved = await store.append({ pid: 123, command: 'monitor-cpu', success: true, result: { cpuPercent: 2 } })
		expect((await store.list()).map((item) => item.id)).toEqual([saved.id])
		expect(store.warnings.join(' ')).toContain('1000-11111111')
		expect(await readdir(dir)).toContain('1000-11111111-1111-4111-8111-111111111111.json')
	})

	it('does not lose simultaneous appends from independent store instances', async () => {
		const dir = await directory()
		await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				new HistoryStore({ directory: dir }).append({
					pid: 123,
					command: 'monitor-cpu',
					success: true,
					result: { cpuPercent: index },
				})
			)
		)
		expect(await new HistoryStore({ directory: dir }).list()).toHaveLength(8)
	})

	it('rejects incompatible comparisons and oversized results without deleting history', async () => {
		const dir = await directory()
		const store = new HistoryStore({ directory: dir, maxBytes: 2048 })
		const first = await store.append({ pid: 123, command: 'monitor-cpu', success: true, result: { cpuPercent: 0 } })
		const second = await store.append({ pid: 456, command: 'monitor-cpu', success: true, result: { cpuPercent: 10 } })
		await expect(store.compare(first.id, second.id)).rejects.toThrow('same process')
		await expect(store.compare(first.id, 'missing')).rejects.toThrow('not found')
		await expect(
			store.append({ pid: 123, command: 'run-code', success: true, result: 'x'.repeat(4096) })
		).rejects.toThrow('exceeds')
		expect(await store.list()).toHaveLength(2)
	})

	it('extracts only declared artifact paths and uses explicit configuration first', () => {
		expect(
			extractArtifactPaths({
				filename: '/tmp/a.heapsnapshot',
				text: '/etc/passwd',
				artifacts: ['/tmp/b.cpuprofile'],
				nested: { filename: '/tmp/a.heapsnapshot' },
			})
		).toEqual(['/tmp/a.heapsnapshot', '/tmp/b.cpuprofile'])
		expect(resolveHistoryDirectory('/tmp/explicit')).toBe('/tmp/explicit')
	})
})

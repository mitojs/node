import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { calculateCpuPercent, getCpuSnapshotInjectable } from '../recipes/cpu'
import { takeHeapSnapshot } from '../recipes/heap-snapshot'
import { collectMemoryMetrics, getMemorySnapshotInjectable } from '../recipes/memory'

const directories: string[] = []
afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
describe('shared collection recipes', () => {
	it.each([
		[50000, 30000, 1000000, 8, 5],
		[500000, 500000, 1000000, 100, 50],
		[0, 0, 1000000, 0, 0],
		[800, 0, 1000, 80, 80],
		[2000000, 0, 1000000, 200, 200],
	])('calculates usage from microsecond differences (%i,%i,%i)', (user, system, time, load, useLoad) => {
		expect(calculateCpuPercent(user, system, time)).toEqual({ load, useLoad })
	})
	it('returns monotonic CPU samples suitable for a second sampling window', () => {
		const collect = new Function('process', getCpuSnapshotInjectable())
		const first = collect(process)
		const second = collect(process)
		expect(second.cpuUsage.user).toBeGreaterThanOrEqual(first.cpuUsage.user)
		expect(BigInt(second.hrtime)).toBeGreaterThan(BigInt(first.hrtime))
	})
	it('returns process and V8 memory using their documented byte units', () => {
		const data = collectMemoryMetrics()
		expect(data.memory.rss).toBeGreaterThan(0)
		expect(data.heapInfo.total_heap_size).toBeGreaterThanOrEqual(data.heapInfo.used_heap_size)
		expect(data.heapSpaces.length).toBeGreaterThan(0)
	})
	it('reads the lightweight snapshot from the target process rather than CLI memory', () => {
		const collect = new Function('process', getMemorySnapshotInjectable())
		expect(collect({ memoryUsage: () => ({ heapUsed: 12, heapTotal: 24, rss: 48 }) })).toEqual({
			heapUsed: 12,
			heapTotal: 24,
			rss: 48,
		})
	})
	it('writes an actual heap snapshot to the caller supplied path', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'mito-shared-snapshot-'))
		directories.push(directory)
		const filename = join(directory, 'heap.heapsnapshot')
		expect(takeHeapSnapshot(filename)).toEqual({ filename })
		expect((await stat(filename)).size).toBeGreaterThan(1000)
	})
})

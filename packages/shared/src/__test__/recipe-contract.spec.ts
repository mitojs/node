import { describe, expect, it } from 'vitest'
import { calculateCpuPercent } from '../recipes/cpu'
import { getHeapSnapshotInjectable } from '../recipes/heap-snapshot'
import { getMemoryInjectable } from '../recipes/memory'

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
describe('injected recipe runtime contracts', () => {
	it('collects memory in an ESM context without require', async () => {
		const result = await new AsyncFunction('process', 'require', getMemoryInjectable())(process, undefined)
		expect(result.memory.rss).toBeGreaterThan(0)
		expect(result.heapInfo.used_heap_size).toBeGreaterThan(0)
	})
	it('passes a quoted snapshot path as data rather than executable source', async () => {
		let saved = ''
		const filename = "/tmp/quoted-'folder/snapshot.heapsnapshot"
		await new AsyncFunction('process', 'require', getHeapSnapshotInjectable(filename))(
			{
				getBuiltinModule: () => ({
					writeHeapSnapshot: (value: string) => {
						saved = value
					},
				}),
			},
			undefined
		)
		expect(saved).toBe(filename)
	})
	it('rejects an invalid sample window instead of emitting a non-finite CPU result', () => {
		expect(() => calculateCpuPercent(100, 20, 0)).toThrow(/sample|time|positive/i)
	})
})

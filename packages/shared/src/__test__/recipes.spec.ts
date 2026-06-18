import { describe, expect, it } from 'vitest'
import { calculateCpuPercent, getCpuSnapshotInjectable } from '../recipes/cpu'
import { getHeapSnapshotInjectable, takeHeapSnapshot } from '../recipes/heap-snapshot'
import { collectMemoryMetrics, getMemoryInjectable, getMemorySnapshotInjectable } from '../recipes/memory'

describe('recipes', () => {
	describe('cpu', () => {
		describe('calculateCpuPercent', () => {
			it('should calculate correct CPU load percentages', () => {
				// 50ms user + 30ms system over 1000ms elapsed
				const result = calculateCpuPercent(50000, 30000, 1000000)
				expect(result.load).toBeCloseTo(8)
				expect(result.useLoad).toBeCloseTo(5)
			})

			it('should return 100% when CPU is fully utilized', () => {
				// 全部 elapsed 时间都在 CPU 上
				const result = calculateCpuPercent(500000, 500000, 1000000)
				expect(result.load).toBeCloseTo(100)
				expect(result.useLoad).toBeCloseTo(50)
			})

			it('should return 0% with zero diffs', () => {
				const result = calculateCpuPercent(0, 0, 1000000)
				expect(result.load).toBe(0)
				expect(result.useLoad).toBe(0)
			})

			it('should handle small time intervals correctly', () => {
				// 1ms interval, 0.8ms user CPU
				const result = calculateCpuPercent(800, 0, 1000)
				expect(result.load).toBeCloseTo(80)
				expect(result.useLoad).toBeCloseTo(80)
			})
		})

		describe('getCpuSnapshotInjectable', () => {
			it('should return valid injectable code string', () => {
				const code = getCpuSnapshotInjectable()
				expect(code).toContain('process.cpuUsage()')
				expect(code).toContain('process.hrtime.bigint()')
				expect(code).toContain('return')
			})
		})
	})

	describe('memory', () => {
		describe('collectMemoryMetrics', () => {
			it('should return memory data with all required fields', () => {
				const data = collectMemoryMetrics()
				expect(data).toHaveProperty('heapInfo')
				expect(data).toHaveProperty('heapSpaces')
				expect(data).toHaveProperty('memory')
				expect(data.heapInfo).toHaveProperty('total_heap_size')
				expect(data.heapInfo).toHaveProperty('used_heap_size')
				expect(Array.isArray(data.heapSpaces)).toBe(true)
				expect(data.memory).toHaveProperty('rss')
				expect(data.memory).toHaveProperty('heapUsed')
				expect(data.memory).toHaveProperty('heapTotal')
			})
		})

		describe('getMemoryInjectable', () => {
			it('should return code that collects full memory info', () => {
				const code = getMemoryInjectable()
				expect(code).toContain("require('v8')")
				expect(code).toContain('getHeapStatistics()')
				expect(code).toContain('getHeapSpaceStatistics()')
				expect(code).toContain('process.memoryUsage()')
			})
		})

		describe('getMemorySnapshotInjectable', () => {
			it('should return code that collects lightweight memory snapshot', () => {
				const code = getMemorySnapshotInjectable()
				expect(code).toContain('process.memoryUsage()')
				expect(code).toContain('heapUsed')
				expect(code).toContain('heapTotal')
				expect(code).toContain('rss')
				// 不应包含完整的 v8 heap 信息
				expect(code).not.toContain('getHeapStatistics')
			})
		})
	})

	describe('heap-snapshot', () => {
		describe('takeHeapSnapshot', () => {
			it('should call v8.writeHeapSnapshot and return filename', () => {
				const testFile = '/tmp/test-snapshot.heapsnapshot'
				const result = takeHeapSnapshot(testFile)
				expect(result).toEqual({ filename: testFile })
			})
		})

		describe('getHeapSnapshotInjectable', () => {
			it('should return code containing v8.writeHeapSnapshot call', () => {
				const filename = '/tmp/test.heapsnapshot'
				const code = getHeapSnapshotInjectable(filename)
				expect(code).toContain("require('v8')")
				expect(code).toContain('writeHeapSnapshot')
				expect(code).toContain(filename)
			})

			it('should embed the filename in the generated code', () => {
				const filename = '/tmp/custom-path/snapshot-123.heapsnapshot'
				const code = getHeapSnapshotInjectable(filename)
				expect(code).toContain(`'${filename}'`)
			})

			it('should include version check for writeHeapSnapshot', () => {
				const code = getHeapSnapshotInjectable('/tmp/test.heapsnapshot')
				expect(code).toContain('typeof v8.writeHeapSnapshot')
				expect(code).toContain('throw new Error')
			})
		})
	})
})

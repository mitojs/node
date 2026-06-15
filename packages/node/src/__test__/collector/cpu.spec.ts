import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCpuUsage = vi.fn()
const mockHrtimeBigint = vi.fn()

vi.mock('node:process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:process')>()
	return {
		...actual,
		default: actual,
		cpuUsage: mockCpuUsage,
		hrtime: { ...actual.hrtime, bigint: mockHrtimeBigint },
	}
})

describe('CPUCollector', () => {
	beforeEach(() => {
		mockCpuUsage
			.mockImplementationOnce(() => ({
				user: 1000,
				system: 2000,
			})) // init时第一次获取CPU使用率
			.mockImplementationOnce(() => ({
				user: 2000,
				system: 4000,
			})) // get时第二次获取CPU使用率
		mockHrtimeBigint
			.mockImplementationOnce(() => 1000000000n) // init时第一次获取当前时间
			.mockImplementationOnce(() => 2000000000n) // get时第二次获取当前时间
	})

	afterEach(() => {
		vi.restoreAllMocks()
		mockCpuUsage.mockReset()
		mockHrtimeBigint.mockReset()
	})

	describe('get', () => {
		// 验证 get() 能根据两次采样计算出正确的 CPU 负载
		it('should calculate CPU usage correctly', async () => {
			const { CPUCollector } = await import('../../collector/cpu')
			const cpuCollector = new CPUCollector()
			expect(cpuCollector.get()).toEqual({
				load: 0.3,
				useLoad: 0.1,
			})
		})
	})

	describe('destroy', () => {
		// 验证 destroy() 会重置内部状态，方便下次重新采样
		it('should reset internal state', async () => {
			const { CPUCollector } = await import('../../collector/cpu')
			const cpuCollector = new CPUCollector()
			expect(cpuCollector['_lastHrtime']).toBe(1000000000n)
			expect(cpuCollector['_lastCpuUsage']).toEqual({
				user: 1000,
				system: 2000,
			})
			expect(cpuCollector['_teardown']).toHaveLength(0)
			cpuCollector.destroy()
			expect(cpuCollector['_lastHrtime']).toBe(0n)
			expect(cpuCollector['_lastCpuUsage']).toEqual({
				user: 0,
				system: 0,
			})
		})
	})
})

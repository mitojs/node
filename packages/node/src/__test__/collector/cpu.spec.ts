import { CPUCollector } from '../../collector/cpu'

describe('CPUCollector', () => {
	beforeEach(() => {
		jest
			.spyOn(process, 'cpuUsage') // 单位：微妙
			.mockImplementationOnce(() => ({
				user: 1000,
				system: 2000,
			})) // init时第一次获取CPU使用率
			.mockImplementationOnce(() => ({
				user: 2000,
				system: 4000,
			})) // get时第二次获取CPU使用率
		jest
			.spyOn(process.hrtime, 'bigint') // 单位：纳秒
			.mockImplementationOnce(() => 1000000000n) // init时第一次获取当前时间
			.mockImplementationOnce(() => 2000000000n) // get时第二次获取当前时间
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	describe('get', () => {
		// 验证 get() 能根据两次采样计算出正确的 CPU 负载
		it('should calculate CPU usage correctly', () => {
			const cpuCollector = new CPUCollector()
			expect(cpuCollector.get()).toEqual({
				load: 0.3,
				useLoad: 0.1,
			})
		})
	})

	describe('destroy', () => {
		// 验证 destroy() 会重置内部状态，方便下次重新采样
		it('should reset internal state', () => {
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

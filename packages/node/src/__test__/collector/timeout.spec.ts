import { TimeoutCollector } from '../../collector/timeout'

describe('TimeoutCollector', () => {
	afterEach(() => {
		jest.clearAllMocks()
	})
	describe('init And destroy', () => {
		// 验证创建实例对象时，是否有劫持setTimeout和setInterval
		// 验证 destroy 后，是否恢复原始的 setTimeout 和 setInterval
		it('should init collector And hijack setTimeout and setInterval', () => {
			const originalSetTimeout = global.setTimeout
			const originalSetInterval = global.setInterval

			const collector = new TimeoutCollector()
			expect(global.setTimeout).not.toBe(originalSetTimeout)
			expect(global.setInterval).not.toBe(originalSetInterval)
			expect(collector['_teardown']).toHaveLength(1)

			collector.destroy()
			// 恢复劫持前
			expect(global.setTimeout).toBe(originalSetTimeout)
			expect(global.setInterval).toBe(originalSetInterval)
		})
	})

	describe('get', () => {
		it('should return the timeout map', () => {
			// 验证 get方法可以拿到定时器的调用栈信息和name
			const collector = new TimeoutCollector()
			const timeoutMap = collector.get()
			expect(timeoutMap).toBeDefined()
			expect(timeoutMap.size).toBe(0)

			const time1 = setTimeout(() => {}, 1000)
			const time2 = setInterval(() => {}, 1000)

			expect(timeoutMap.size).toBe(2)
			expect(timeoutMap.get(1)?.name).toBe('setTimeout')
			console.log(timeoutMap.get(1)?.stack, 888)
			expect(timeoutMap.get(1)?.stack).toContain('timeout.spec.ts')
			expect(timeoutMap.get(2)?.name).toBe('setInterval')
			expect(timeoutMap.get(2)?.stack).toContain('timeout.spec.ts')

			// 清除定时器
			collector.destroy()
			expect(timeoutMap.size).toBe(0)
			clearTimeout(time1)
			clearInterval(time2)
		})
	})
})

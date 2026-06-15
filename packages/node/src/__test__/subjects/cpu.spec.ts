import { SubjectNames } from '../../shared'
import { CPUSubject } from '../../subjects/cpu'

describe('CPUSubject', () => {
	beforeEach(() => {
		jest.useFakeTimers()
		// mock cpuUsage 和 hrtime.bigint 以获得稳定的测试结果
		jest.spyOn(process, 'cpuUsage').mockReturnValue({ user: 1000, system: 2000 })
		jest.spyOn(process.hrtime, 'bigint').mockReturnValue(1000000000n)
	})

	afterEach(() => {
		jest.useRealTimers()
		jest.restoreAllMocks()
	})

	describe('getSubjectName', () => {
		it('should return SubjectNames.CPU', () => {
			const subject = new CPUSubject()
			expect(subject.getSubjectName()).toBe(SubjectNames.CPU)
			expect(subject.getSubjectName()).toBe('CPU')
			subject.clearTimer()
		})
	})

	describe('start', () => {
		it('should begin emitting data via subscribe', () => {
			// 重置 mock 以模拟真实的两次采样
			jest.restoreAllMocks()
			jest
				.spyOn(process, 'cpuUsage')
				.mockReturnValueOnce({ user: 1000, system: 2000 }) // constructor 初始化
				.mockReturnValueOnce({ user: 2000, system: 4000 }) // 第一次 get()
			jest
				.spyOn(process.hrtime, 'bigint')
				.mockReturnValueOnce(1000000000n) // constructor 初始化
				.mockReturnValueOnce(2000000000n) // 第一次 get()

			const subject = new CPUSubject({ interval: 1000 })
			const callback = jest.fn()

			subject.subscribe(callback)
			subject.start()

			// 还未到时间，不应该有数据
			expect(callback).not.toHaveBeenCalled()

			// 推进 1 秒
			jest.advanceTimersByTime(1000)

			expect(callback).toHaveBeenCalledTimes(1)
			const emittedData = callback.mock.calls[0][0]
			expect(emittedData).toHaveProperty('load')
			expect(emittedData).toHaveProperty('useLoad')
			expect(typeof emittedData.load).toBe('number')
			expect(typeof emittedData.useLoad).toBe('number')

			subject.clearTimer()
		})

		it('should emit data at each interval tick', () => {
			jest.restoreAllMocks()
			jest.spyOn(process, 'cpuUsage').mockReturnValue({ user: 1000, system: 2000 })
			jest.spyOn(process.hrtime, 'bigint').mockReturnValue(1000000000n)

			const subject = new CPUSubject({ interval: 500 })
			const callback = jest.fn()

			subject.subscribe(callback)
			subject.start()

			jest.advanceTimersByTime(500)
			expect(callback).toHaveBeenCalledTimes(1)

			jest.advanceTimersByTime(500)
			expect(callback).toHaveBeenCalledTimes(2)

			jest.advanceTimersByTime(500)
			expect(callback).toHaveBeenCalledTimes(3)

			subject.clearTimer()
		})

		it('should use custom interval when passed to start()', () => {
			jest.restoreAllMocks()
			jest.spyOn(process, 'cpuUsage').mockReturnValue({ user: 1000, system: 2000 })
			jest.spyOn(process.hrtime, 'bigint').mockReturnValue(1000000000n)

			const subject = new CPUSubject({ interval: 5000 })
			const callback = jest.fn()

			subject.subscribe(callback)
			subject.start({ interval: 2000 })

			jest.advanceTimersByTime(2000)
			expect(callback).toHaveBeenCalledTimes(1)

			// 原始 5000ms 间隔下不应有额外的调用
			jest.advanceTimersByTime(2000)
			expect(callback).toHaveBeenCalledTimes(2)

			subject.clearTimer()
		})
	})

	describe('clearTimer', () => {
		it('should stop polling after clearTimer is called', () => {
			jest.restoreAllMocks()
			jest.spyOn(process, 'cpuUsage').mockReturnValue({ user: 1000, system: 2000 })
			jest.spyOn(process.hrtime, 'bigint').mockReturnValue(1000000000n)

			const subject = new CPUSubject({ interval: 1000 })
			const callback = jest.fn()

			subject.subscribe(callback)
			subject.start()

			jest.advanceTimersByTime(1000)
			expect(callback).toHaveBeenCalledTimes(1)

			subject.clearTimer()

			// clearTimer 后不应再有新数据
			jest.advanceTimersByTime(3000)
			expect(callback).toHaveBeenCalledTimes(1)
		})
	})

	describe('getCollector', () => {
		it('should return the internal CPUCollector instance', () => {
			const subject = new CPUSubject()
			const collector = subject.getCollector()
			expect(collector).not.toBeNull()
			expect(collector!.get).toBeDefined()
			subject.clearTimer()
		})
	})

	describe('teardown', () => {
		it('should clear timer and null out collector', () => {
			jest.restoreAllMocks()
			jest.spyOn(process, 'cpuUsage').mockReturnValue({ user: 1000, system: 2000 })
			jest.spyOn(process.hrtime, 'bigint').mockReturnValue(1000000000n)

			const subject = new CPUSubject({ interval: 1000 })
			const callback = jest.fn()

			subject.subscribe(callback)
			subject.start()

			jest.advanceTimersByTime(1000)
			expect(callback).toHaveBeenCalledTimes(1)

			// 手动调用 teardown
			subject['teardown']()

			jest.advanceTimersByTime(3000)
			expect(callback).toHaveBeenCalledTimes(1)
			expect(subject.getCollector()).toBeNull()
		})
	})
})

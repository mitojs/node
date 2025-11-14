import { JsErrorCollector } from '../../collector/js-error'

describe('JSErrorCollector', () => {
	let collector: JsErrorCollector

	beforeEach(() => {
		collector = new JsErrorCollector()
	})

	afterEach(() => {
		collector.destroy()
	})

	describe('subscribe', () => {
		it('should support subscribing with an array of callbacks or a single callback', () => {
			const subscriber1 = jest.fn()
			collector.subscribe(subscriber1)
			expect(collector['_subscribers']).toContain(subscriber1)
			expect(collector['_subscribers']).toHaveLength(1)

			const subscriber2 = jest.fn()
			collector.subscribe([subscriber1, subscriber2])
			expect(collector['_subscribers']).toContain(subscriber1)
			expect(collector['_subscribers']).toContain(subscriber2)
			expect(collector['_subscribers']).toHaveLength(3)
		})
	})

	describe('event listening', () => {
		it('should register event listeners on initialization', () => {
			expect(collector['_teardown']).toHaveLength(1)
		})

		it('should call subscribers when uncaughtException occurs', () => {
			const subscriber = jest.fn()
			collector.subscribe(subscriber)
			const error = new Error('Test error')

			process.emit('uncaughtException', error)

			expect(subscriber).toHaveBeenCalledWith(error)
			expect(subscriber).toHaveBeenCalledTimes(1)
		})

		it('should call all subscribers when error occurs', () => {
			const subscriber1 = jest.fn()
			const subscriber2 = jest.fn()
			collector.subscribe([subscriber1, subscriber2])
			const error = new Error('Test error')

			process.emit('uncaughtException', error)

			expect(subscriber1).toHaveBeenCalledWith(error)
			expect(subscriber2).toHaveBeenCalledWith(error)
		})
	})

	describe('destroy', () => {
		it('should clear subscribers and teardown functions(remove event listeners)', () => {
			const subscriber = jest.fn()
			collector.subscribe(subscriber)
			const error = new Error('Test error')
			process.emit('uncaughtException', error)
			expect(subscriber).toHaveBeenCalledWith(error)
			expect(collector['_subscribers']).toHaveLength(1)
			expect(collector['_teardown']).toHaveLength(1)

			// 重置计数
			subscriber.mockClear()
			// destroy 后，监听器应该被移除
			collector.destroy()
			process.emit('uncaughtException', error)

			expect(collector['_subscribers']).toHaveLength(0)
			expect(collector['_teardown']).toHaveLength(0)
			expect(subscriber).not.toHaveBeenCalled()
		})
	})
})

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
		// 验证 subscribe() 同时支持单个回调和回调数组的注册
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
		// 验证初始化时已注册事件监听器
		it('should register event listeners on initialization', () => {
			expect(collector['_teardown']).toHaveLength(1)
		})

		// 验证 uncaughtException 触发时，订阅者会收到对应错误
		it('should call subscribers when uncaughtException occurs', () => {
			const subscriber = jest.fn()
			collector.subscribe(subscriber)
			const error = new Error('Test error')

			process.emit('uncaughtException', error)

			expect(subscriber).toHaveBeenCalledWith(error)
			expect(subscriber).toHaveBeenCalledTimes(1)
		})

		// 验证存在多个订阅者时，所有订阅者都会收到错误通知
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
		// 验证 destroy() 会清空订阅者与 teardown(清理函数)，并移除事件监听器
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

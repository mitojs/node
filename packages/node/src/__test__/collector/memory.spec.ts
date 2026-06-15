import { MemoryCollector } from '../../collector/memory'

describe('MemoryCollector', () => {
	describe('get', () => {
		it('should return object with expected keys', () => {
			const collector = new MemoryCollector()
			const data = collector.get()

			expect(data).toHaveProperty('heapInfo')
			expect(data).toHaveProperty('heapSpaces')
			expect(data).toHaveProperty('memory')
		})

		it('should return heapInfo with numeric values', () => {
			const collector = new MemoryCollector()
			const data = collector.get()

			expect(typeof data.heapInfo.total_heap_size).toBe('number')
			expect(typeof data.heapInfo.used_heap_size).toBe('number')
			expect(typeof data.heapInfo.heap_size_limit).toBe('number')
			expect(typeof data.heapInfo.total_available_size).toBe('number')
		})

		it('should return heapSpaces as an array with valid entries', () => {
			const collector = new MemoryCollector()
			const data = collector.get()

			expect(Array.isArray(data.heapSpaces)).toBe(true)
			expect(data.heapSpaces.length).toBeGreaterThan(0)

			const firstSpace = data.heapSpaces[0]
			expect(firstSpace).toHaveProperty('space_name')
			expect(firstSpace).toHaveProperty('space_size')
			expect(typeof firstSpace.space_name).toBe('string')
			expect(typeof firstSpace.space_size).toBe('number')
		})

		it('should return memory with standard process.memoryUsage keys', () => {
			const collector = new MemoryCollector()
			const data = collector.get()

			expect(typeof data.memory.rss).toBe('number')
			expect(typeof data.memory.heapTotal).toBe('number')
			expect(typeof data.memory.heapUsed).toBe('number')
			expect(typeof data.memory.external).toBe('number')
		})

		it('should return positive values for memory metrics', () => {
			const collector = new MemoryCollector()
			const data = collector.get()

			expect(data.memory.rss).toBeGreaterThan(0)
			expect(data.memory.heapTotal).toBeGreaterThan(0)
			expect(data.memory.heapUsed).toBeGreaterThan(0)
			expect(data.heapInfo.total_heap_size).toBeGreaterThan(0)
		})

		it('should return consistent data across multiple calls', () => {
			const collector = new MemoryCollector()
			const data1 = collector.get()
			const data2 = collector.get()

			// 两次调用都应有相同的结构
			expect(Object.keys(data1)).toEqual(Object.keys(data2))
			expect(data1.heapSpaces.length).toBe(data2.heapSpaces.length)
		})
	})
})

import { memoryUsage } from 'node:process'
import { getHeapSpaceStatistics, getHeapStatistics, type HeapInfo, type HeapSpaceInfo } from 'node:v8'

export interface MemoryData {
	heapInfo: HeapInfo
	heapSpaces: HeapSpaceInfo[]
	memory: NodeJS.MemoryUsage
}
export class MemoryCollector {
	public getData(): MemoryData {
		const heapInfo = getHeapStatistics()
		const heapSpaces = getHeapSpaceStatistics()
		return {
			heapInfo,
			heapSpaces,
			memory: memoryUsage(),
		}
		// 	heapSpaces.map((item) => {
		// 		item.space_name
		// 		item.space_size
		// 		item.space_used_size
		// 		item.space_available_size
		// 		item.physical_space_size
		// 	})
		// 	const memory = memoryUsage()
		// 	memory.rss
		// 	memory.heapTotal
		// 	memory.heapUsed
		// 	memory.external
		// 	memory.arrayBuffers
		// }
	}
}

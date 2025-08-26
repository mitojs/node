import { memoryUsage } from 'node:process'
import { getHeapSpaceStatistics, getHeapStatistics, type HeapInfo, type HeapSpaceInfo } from 'node:v8'
import { BaseCollector } from './base'

export interface MemoryData {
	heapInfo: HeapInfo
	heapSpaces: HeapSpaceInfo[]
	memory: NodeJS.MemoryUsage
}

export class MemoryCollector extends BaseCollector<MemoryData> {
	public get() {
		const heapInfo = getHeapStatistics()
		const heapSpaces = getHeapSpaceStatistics()
		return {
			heapInfo,
			heapSpaces,
			memory: memoryUsage(),
		}
	}
}

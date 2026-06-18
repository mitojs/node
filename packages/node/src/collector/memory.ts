import { memoryUsage } from 'node:process'
import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8'
import type { MemoryData } from '@mitojs/node-shared/types'
import { BaseCollector } from './base'

export type { MemoryData } from '@mitojs/node-shared/types'

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

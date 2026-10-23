import type { HeapInfo, HeapSpaceInfo } from 'node:v8'

export interface CPUData {
	load: number
	useLoad: number
}

export interface MemoryData {
	heapInfo: HeapInfo
	heapSpaces: HeapSpaceInfo[]
	memory: NodeJS.MemoryUsage
}

export interface HeapSnapshotResult {
	filename: string
}

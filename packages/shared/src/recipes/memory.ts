import type { MemoryData } from '../types/metrics'

/**
 * 内存指标采集逻辑 — SDK Subject 中直接调用
 */
export function collectMemoryMetrics(): MemoryData {
	const v8 = require('node:v8')
	const process = require('node:process')
	return {
		heapInfo: v8.getHeapStatistics(),
		heapSpaces: v8.getHeapSpaceStatistics(),
		memory: process.memoryUsage(),
	}
}

/**
 * 可注入目标进程的内存采集代码 — CLI Inspector fallback 使用
 */
export function getMemoryInjectable(): string {
	return `
		const v8 = require('v8');
		return {
			heapInfo: v8.getHeapStatistics(),
			heapSpaces: v8.getHeapSpaceStatistics(),
			memory: process.memoryUsage()
		};
	`
}

/**
 * 轻量内存快照（仅 heapUsed/heapTotal/rss）— 用于 monitor 场景
 */
export function getMemorySnapshotInjectable(): string {
	return `
		const mem = process.memoryUsage();
		return { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss };
	`
}

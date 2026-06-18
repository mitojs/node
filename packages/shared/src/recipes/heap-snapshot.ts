import type { HeapSnapshotResult } from '../types/metrics'

/**
 * 堆快照执行逻辑 — SDK Subject 中直接调用
 */
export function takeHeapSnapshot(filename: string): HeapSnapshotResult {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const v8 = require('node:v8')
	if (typeof v8.writeHeapSnapshot === 'function') {
		v8.writeHeapSnapshot(filename)
		return { filename }
	}
	throw new Error('Node.js version does not support v8.writeHeapSnapshot')
}

/**
 * 可注入目标进程的代码模板 — CLI 通过 Inspector 注入时使用
 * 设计决策：分离为模板字符串，因为 Inspector evaluate 无法引用外部模块
 */
export function getHeapSnapshotInjectable(filename: string): string {
	return `
		const v8 = require('v8');
		if (typeof v8.writeHeapSnapshot === 'function') {
			v8.writeHeapSnapshot('${filename}');
		} else {
			throw new Error('Node.js version does not support v8.writeHeapSnapshot');
		}
	`
}

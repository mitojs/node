import deepMerge from 'deepmerge'
import { configMap } from './config'
import { registerProcessToAgent } from './request'
import { DEFAULT_TCP_PORT, isMainThread, MITO_NODE, SubjectNames } from './shared'
import type { MitoNodeOption } from './types'

export function preCheck() {
	if (global[MITO_NODE]) throw new Error('has been initialized')
	if (!isMainThread) throw new Error('mitojs-node only support in main thread')
	global[MITO_NODE] = true
}
export function initConfig() {
	const port = Number(process.env.MITO_AGENT_TCP_PORT || DEFAULT_TCP_PORT)
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error('MITO_AGENT_TCP_PORT must be an integer between 1 and 65535')
	configMap.update({ agentTCPPort: port, agentHost: '127.0.0.1', pid: process.pid })
}
export const DEFAULT_MITO_NODE_OPTION: MitoNodeOption = {
	metrics: {
		[SubjectNames.CPU]: true,
		[SubjectNames.Memory]: true,
		[SubjectNames.JSError]: true,
		[SubjectNames.Timeout]: true,
	},
}
export function initOption(option?: MitoNodeOption) {
	const merged = deepMerge(DEFAULT_MITO_NODE_OPTION, option || {})
	for (const config of Object.values(merged.metrics || {})) {
		if (
			typeof config === 'object' &&
			config.interval !== undefined &&
			(!Number.isFinite(config.interval) || config.interval <= 0)
		)
			throw new Error('Metric interval must be positive')
	}
	return merged
}
// 注册失败必须交还调用方回滚，不能继续宣布 SDK 启动成功。
export function SyncToAgent(enabledSubjects: string[], intervals: Record<string, number> = {}, signal?: AbortSignal) {
	return registerProcessToAgent({ pid: process.pid, subjects: enabledSubjects, intervals }, signal)
}

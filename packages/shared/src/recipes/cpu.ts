import type { CPUData } from '../types/metrics'

/**
 * CPU 使用率百分比计算 — 从两次采样差值计算 load
 * 协议约束：userDiff/systemDiff 单位为微秒，timeDiffMicros 同样为微秒
 */
export function calculateCpuPercent(userDiff: number, systemDiff: number, timeDiffMicros: number): CPUData {
	const load = ((userDiff + systemDiff) / timeDiffMicros) * 100
	const useLoad = (userDiff / timeDiffMicros) * 100
	return { load, useLoad }
}

/**
 * 可注入目标进程的 CPU 快照代码 — CLI Inspector fallback 使用
 * 返回 process.cpuUsage() 原始值和当前时间戳，由 CLI 侧计算百分比
 */
export function getCpuSnapshotInjectable(): string {
	return `
		return {
			cpuUsage: process.cpuUsage(),
			hrtime: Number(process.hrtime.bigint())
		};
	`
}

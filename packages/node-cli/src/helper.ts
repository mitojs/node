import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type { DiagnosticContext, DiagnosticResult } from './core/types.js'
import { InspectorSession } from './services/inspector-session.js'

export { DataSource } from '@mitojs/node-shared/constants'

const tmpdirPath = tmpdir()

export function getDay(): string {
	const date = new Date()
	return [date.getFullYear(), padding(date.getMonth() + 1), padding(date.getDate())].join('_')
}

export function padding(val: number): string {
	return val >= 0 && val <= 9 ? `0${val}` : `${val}`
}

export function genFilename(ext: string, directory = tmpdirPath): string {
	const destination = resolve(directory)
	mkdirSync(destination, { recursive: true })
	return join(destination, `${uuidv4()}.${ext}`)
}

export function safeCallSync<T>(fn: (...args: any[]) => T, ...args: any[]): T | undefined {
	try {
		return fn(...args)
	} catch {
		return undefined
	}
}

/**
 * Agent 通道有数据时 bin.ts 不会预先打开 Inspector，
 * 当插件确实需要 Inspector 时调用此函数按需建立连接。
 */
export async function ensureSession(ctx: DiagnosticContext): Promise<InspectorSession> {
	if (ctx.session) return ctx.session
	const session = new InspectorSession({ timeout: ctx.timeout, signal: ctx.signal })
	ctx.session = session
	await session.open(ctx.pid, ctx.port)
	await session.connect(ctx.port)
	return session
}

export const FUNCTION_WRAPPER = (code: string) => `(async function() {
        try {
            const data = await (async function() {
                ${code}
            })();
            const ret = { code: 0 };
            if (data !== undefined) {
                ret.data = data;
            }
            return JSON.stringify(ret);
        } catch (e) {
            return JSON.stringify({code : -1, message: e.message});
        }
    })();
    `

export function ok(data: any, source?: string): DiagnosticResult {
	if (source) {
		return { success: true, data: { ...data, source } }
	}
	return { success: true, data }
}

export function fail(error: string, errorCode = 'DIAGNOSTIC_FAILED', suggestion?: string): DiagnosticResult {
	return { success: false, error, errorCode, ...(suggestion ? { suggestion } : {}) }
}

/** Abort only our wait; an already-running synchronous target operation cannot be rolled back. */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			clearTimeout(timer)
			signal?.removeEventListener('abort', abort)
			reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Operation cancelled', 'AbortError'))
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', abort)
			resolve()
		}, ms)
		if (signal?.aborted) abort()
		else signal?.addEventListener('abort', abort, { once: true })
	})
}

export async function readAgentMetrics(ctx: DiagnosticContext, subject: string) {
	if (!ctx.agentClient) return null
	const info = await ctx.agentClient.getProcessInfo(ctx.pid)
	ctx.processInfo = info
	if (!info || !info.registeredSubjects.includes(subject)) return null
	const sampledAt = info.updatedAt[subject]
	const interval = info.intervals[subject] || 5000
	if (!Number.isFinite(sampledAt) || Date.now() - sampledAt > interval * 3 || sampledAt > Date.now() + 1000) return null
	return info.metrics
}

import { tmpdir } from 'node:os'
import { v4 as uuidv4 } from 'uuid'
import type { DiagnosticContext } from './core/types.js'
import { InspectorSession } from './services/inspector-session.js'

const tmpdirPath = tmpdir()

export function getDay(): string {
	const date = new Date()
	return [date.getFullYear(), padding(date.getMonth() + 1), padding(date.getDate())].join('_')
}

export function padding(val: number): string {
	return val >= 0 && val <= 9 ? `0${val}` : `${val}`
}

export function genFilename(ext: string): string {
	return `${tmpdirPath}/${uuidv4()}.${ext}`
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
	const session = new InspectorSession()
	await session.open(ctx.pid, ctx.port)
	await session.connect(ctx.port)
	ctx.session = session
	return session
}

export const FUNCTION_WRAPPER = (code: string) => `(async function() {
        try {
            const data = await (async function() {
                ${code}
            })();
            const ret = { code: 0 };
            if (data) {
                ret.data = data;
            }
            return JSON.stringify(ret);
        } catch (e) {
            return JSON.stringify({code : -1, message: e.message});
        }
    })();
    `

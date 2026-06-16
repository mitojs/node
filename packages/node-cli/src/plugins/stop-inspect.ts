import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession } from '../helper.js'

export const stopInspectPlugin: DiagnosticPlugin = {
	name: 'stop-inspect',
	description: 'stop inspect the target process',
	async execute(ctx) {
		const session = await ensureSession(ctx)
		// 先返回成功，再 fire-and-forget 关闭 Inspector。
		// closeInspector 会导致 WebSocket 断连，evaluate 无法收到响应。
		session.closeInspector().catch(() => {})
		return { success: true, data: `Inspector of process ${ctx.pid} has been closed` }
	},
}

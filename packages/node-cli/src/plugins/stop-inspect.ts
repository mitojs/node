import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession } from '../helper.js'

export const stopInspectPlugin: DiagnosticPlugin = {
	name: 'stop-inspect',
	description: 'stop inspect the target process',
	async execute(ctx) {
		const session = await ensureSession(ctx)
		await session.closeInspector()
		return { success: true, data: `Inspector of process ${ctx.pid} has been closed` }
	},
}

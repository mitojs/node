import type { DiagnosticPlugin } from '../core/plugin.js'
import { FUNCTION_WRAPPER } from '../helper.js'

export const memoryPlugin: DiagnosticPlugin = {
	name: 'memory',
	description: 'get memory info of the target process',
	async execute(ctx) {
		const data = await ctx.session.evaluate(FUNCTION_WRAPPER(`return process.memoryUsage();`))
		return { success: true, data }
	},
}

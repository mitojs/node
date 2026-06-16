import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession, FUNCTION_WRAPPER, genFilename } from '../helper.js'

export const reportPlugin: DiagnosticPlugin = {
	name: 'report',
	description: 'get report of the target process',
	options: [{ flags: '-d, --dir <dir>', description: 'directory to save the report' }],
	async execute(ctx) {
		const session = await ensureSession(ctx)
		const filename = genFilename('json')
		await session.evaluate(
			FUNCTION_WRAPPER(`
				if (process.report && typeof process.report.writeReport === 'function') {
					process.report.writeReport('${filename}');
				} else {
					throw new Error('Your Node.js version do not support process.report.writeReport API.');
				}
			`)
		)
		return { success: true, data: { filename } }
	},
}

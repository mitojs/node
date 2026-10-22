import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession, FUNCTION_WRAPPER, genFilename, ok } from '../helper.js'
export const reportPlugin: DiagnosticPlugin = {
	name: 'report',
	label: '保存进程报告',
	description: 'Save a Node.js process diagnostic report',
	options: [{ flags: '-d, --dir <dir>', description: 'directory to save the report' }],
	async execute(ctx, options) {
		const session = await ensureSession(ctx)
		const filename = genFilename('json', options.dir)
		await session.evaluate(
			FUNCTION_WRAPPER(`
			if (!process.report || typeof process.report.writeReport !== 'function') throw new Error('process.report is unavailable');
			process.report.writeReport(${JSON.stringify(filename)});
		`)
		)
		return ok({ filename }, 'inspector')
	},
}

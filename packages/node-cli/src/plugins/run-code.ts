import * as fs from 'node:fs'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession, FUNCTION_WRAPPER } from '../helper.js'

export const runCodePlugin: DiagnosticPlugin = {
	name: 'run-code',
	description: 'run code in the target process',
	options: [
		{ flags: '-c, --code <code>', description: 'code to execute' },
		{ flags: '-f, --file <file>', description: 'js file to execute' },
	],
	async execute(ctx, options) {
		let code = options.code || options.file
		if (options.file && /\.js$/.test(options.file)) {
			code = fs.readFileSync(options.file, 'utf8')
		}
		if (!code) {
			return { success: false, error: 'No code or file provided' }
		}
		const session = await ensureSession(ctx)
		const result = await session.evaluate(FUNCTION_WRAPPER(code))
		return { success: true, data: result }
	},
}

import * as fs from 'node:fs'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession, FUNCTION_WRAPPER, fail, ok } from '../helper.js'
export const runCodePlugin: DiagnosticPlugin = {
	name: 'run-code',
	label: '执行诊断代码',
	description: 'Evaluate an expression or a JavaScript body inside the target process',
	options: [
		{ flags: '-c, --code <code>', description: 'JavaScript expression or body (use return for body results)' },
		{ flags: '-f, --file <file>', description: 'JavaScript file to execute' },
	],
	async execute(ctx, options) {
		if ((!options.code && !options.file) || (options.code && options.file))
			return fail('Provide exactly one of --code or --file.', 'INVALID_ARGUMENT')
		let code = options.file ? fs.readFileSync(options.file, 'utf8') : String(options.code)
		if (!options.file) {
			const expression = code.trim().replace(/;\s*$/, '')
			// Parsing chooses expression versus statement-body semantics without executing code in the CLI process.
			try {
				new Function(`return (${expression})`)
				code = `return (${expression})`
			} catch {
				/* A statement body may contain an explicit return. */
			}
		}
		const session = await ensureSession(ctx)
		return ok(await session.evaluate(FUNCTION_WRAPPER(code)))
	},
}

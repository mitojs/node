import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession, FUNCTION_WRAPPER } from '../helper.js'

export const startInspectPlugin: DiagnosticPlugin = {
	name: 'start-inspect',
	description: 'start inspect the target process',
	async execute(ctx) {
		const session = await ensureSession(ctx)
		const { url } = await session.evaluate(
			FUNCTION_WRAPPER(`
				const { url } = require('inspector');
				return { url: url() };
			`)
		)
		const { host, pathname } = new URL(url)
		const devtoolsUrl = `devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=${host}${pathname}`
		return { success: true, data: { devtoolsUrl } }
	},
}

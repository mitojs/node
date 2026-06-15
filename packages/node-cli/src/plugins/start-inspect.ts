import type { DiagnosticPlugin } from '../core/plugin.js'
import { FUNCTION_WRAPPER } from '../helper.js'

export const startInspectPlugin: DiagnosticPlugin = {
	name: 'start-inspect',
	description: 'start inspect the target process',
	async execute(ctx) {
		const { url } = await ctx.session.evaluate(
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

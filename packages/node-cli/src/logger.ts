export const logger = {
	info: (...args: any[]) => console.error('[mito-node-cli]:', ...args),
	error: (...args: any[]) => console.error('[mito-node-cli error]:', ...args),
	debug: (...args: any[]) => {
		if (process.env.MITO_DEBUG) console.error('[mito-node-cli debug]:', ...args)
	},
}

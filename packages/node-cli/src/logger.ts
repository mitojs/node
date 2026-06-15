export const logger = {
	info: (...args: any[]) => console.info('[mito-node-cli]:', ...args),
	error: (...args: any[]) => console.error('[mito-node-cli error]:', ...args),
	debug: (...args: any[]) => {
		if (process.env.MITO_DEBUG) console.debug('[mito-node-cli debug]:', ...args)
	},
}

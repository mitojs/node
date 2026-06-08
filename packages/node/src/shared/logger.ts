export const logger = {
	info: (...args: any[]) => console.info('[mitojs-node]:', ...args),
	error: (...args: any[]) => console.error('[mitojs-node error]:', ...args),
	debug: (...args: any[]) => {
		if (process.env.MITO_DEBUG) console.debug('[mitojs-node debug]:', ...args)
	},
}

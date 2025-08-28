export const logger = {
	info: (...args: any[]) => console.info('[mitojs-node]:', ...args),
	error: (...args: any[]) => console.error('[mitojs-node error]:', ...args),
}

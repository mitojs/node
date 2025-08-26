export function isFunction(func: unknown) {
	return Object.prototype.toString.call(func) === '[object Function]'
}

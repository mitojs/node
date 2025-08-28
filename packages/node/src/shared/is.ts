import { Session } from 'node:inspector'

export function isFunction(func: unknown) {
	return Object.prototype.toString.call(func) === '[object Function]'
}

export const { isMainThread, isSupportWorker, isSupportInspectWorker } = (() => {
	try {
		const { isMainThread } = require('node:worker_threads')
		const isSupportInspectWorker = isFunction(Session.prototype['connectToMainThread'])
		return { isMainThread, isSupportWorker: true, isSupportInspectWorker }
	} catch (_) {
		return { isMainThread: true, isSupportWorker: false, isSupportInspectWorker: false }
	}
})()

import { BaseCollector } from './base'

export class JsErrorCollector extends BaseCollector<Error> {
	private _subscribers: Array<(err: Error) => void> = []

	private handleError(err: Error) {
		this._subscribers.forEach((cb) => cb(err))
	}

	public get() {
		return undefined
	}

	// TODO:这里会重复订阅
	subscribe(cb: ((err: Error) => void) | Array<(err: Error) => void>): void {
		const callbacks = Array.isArray(cb) ? cb : [cb]
		this._subscribers.push(...callbacks)
	}

	protected listen() {
		const boundHandleError = this.handleError.bind(this)
		process.on('uncaughtException', boundHandleError)
		process.on('unhandledRejection', boundHandleError)
		return () => {
			process.off('uncaughtException', boundHandleError)
			process.off('unhandledRejection', boundHandleError)
		}
	}

	destroy(): void {
		super.destroy()
		this._subscribers.length = 0
	}
}

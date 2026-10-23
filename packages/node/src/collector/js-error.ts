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
		// Monitor 不改变 Node 对致命异常和未处理拒绝的默认退出语义。
		process.on('uncaughtExceptionMonitor', boundHandleError)
		return () => {
			process.off('uncaughtExceptionMonitor', boundHandleError)
		}
	}

	destroy(): void {
		super.destroy()
		this._subscribers.length = 0
	}
}

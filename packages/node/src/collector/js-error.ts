import { BaseCollector } from './base'

export class JsErrorCollector extends BaseCollector<Error> {
	private _errInfo: Error | undefined = undefined
	private _subscribers: Array<(err: Error) => void> = []

	public get() {
		if (this._errInfo) {
			// 获取一次后
			const err = this._errInfo
			this._errInfo = undefined
			return err
		}
		return undefined
	}

	private handleError(err: Error) {
		this._errInfo = err
		this._subscribers.forEach((cb) => cb(err))
	}

	subscribe(cb: (err: Error) => void): void {
		this._subscribers.push(cb)
	}

	protected listen() {
		process.on('uncaughtException', this.handleError)
		process.on('unhandledRejection', this.handleError)
		return () => {
			process.off('uncaughtException', this.handleError)
			process.off('unhandledRejection', this.handleError)
		}
	}

	destroy(): void {
		super.destroy()
		this._subscribers.length = 0
		this._errInfo = undefined
	}
}

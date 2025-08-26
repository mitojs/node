import { BaseCollector } from './base'

export interface JsErrorCollectorData {
	errInfo: Error
}

const DEFAULT_ERR_OBJ = new Error('_')
export class JsErrorCollector extends BaseCollector<Error> {
	private _errInfo: Error = DEFAULT_ERR_OBJ
	private _subscribers: Array<(err: Error) => void> = []

	public get() {
		return this._errInfo
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
		this._errInfo = DEFAULT_ERR_OBJ
	}
}

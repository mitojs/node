export abstract class BaseCollector<T> {
	private _teardown: Array<() => void> = []
	constructor() {
		if (this.listen) {
			this._teardown.push(this.listen())
		}
	}

	abstract get(): T
	subscribe?(cb: (data: T) => void): void

	//  外界不允许手动 监听，只能通过 constructor 来 监听
	protected listen?(): () => void

	destroy(): void {
		this._teardown.forEach((teardown) => teardown())
		this._teardown.length = 0
	}
}

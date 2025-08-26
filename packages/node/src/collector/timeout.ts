import { unwrap, wrap } from '../shared/shimmer'
import { getStackFilePath } from '../shared/stack'
import { BaseCollector } from './base'

type TimeoutTypes = 'setTimeout' | 'setInterval'
const TIMER_DESTROYED_KEY = '_destroyed'

type Timer = NodeJS.Timer & {
	[TIMER_DESTROYED_KEY]: boolean
}
type TimeoutInfo = {
	name: TimeoutTypes
	stack: string
	timer: Timer
}
export type TimeoutData = Map<number, TimeoutInfo>

const TIMEOUTS = ['setTimeout', 'setInterval'] as const
export class TimeoutCollector extends BaseCollector<TimeoutData> {
	private _timeoutMap: Map<number, TimeoutInfo> = new Map()

	hook() {
		let id = 0
		const that = this
		const wrapFn = (originalSetTimeout: typeof setTimeout | typeof setInterval, name: TimeoutTypes) => {
			return function (this: any, ...args: any) {
				const timer = originalSetTimeout.apply(this, args)
				const data = {
					timer: timer as any as Timer,
					name,
					stack: getStackFilePath(name),
				}
				that._timeoutMap.set(++id, data)
				return timer
			} as typeof setTimeout
		}

		TIMEOUTS.forEach((name) => {
			// we have to restore the name of current function we wrapped, because  prepareStackTrace will retrieve it on stacks
			// name is enumerable that we assign it in the wrap
			wrap(global, name, wrapFn)
		})
		return () => {
			// 还原劫持
			TIMEOUTS.forEach((name) => {
				unwrap(global, name)
			})
		}
	}

	public get(): TimeoutData {
		return this._timeoutMap
	}

	destroy(): void {
		this._timeoutMap.clear()
	}
}

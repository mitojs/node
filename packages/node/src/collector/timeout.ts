import { unwrap, wrap } from '../shared/shimmer'
import { captureStackFilePath } from '../shared/stack'
import { BaseCollector } from './base'

const TIMER_DESTROYED_KEY = '_destroyed'
const TIMEOUTS = ['setTimeout', 'setInterval'] as const

type TimeoutTypes = 'setTimeout' | 'setInterval'
type Timer = NodeJS.Timer & {
	[TIMER_DESTROYED_KEY]: boolean
}
type TimeoutInfo = {
	name: TimeoutTypes
	stack: string
	timer: Timer
}
export type TimeoutData = Map<number, TimeoutInfo>
export class TimeoutCollector extends BaseCollector<TimeoutData> {
	private _timeoutMap: Map<number, TimeoutInfo> = new Map()
	private _dropped = 0
	private _active = true

	getDroppedCount() {
		return this._dropped
	}

	// 劫持 setTimeout 和 setInterval
	listen() {
		let id = 0
		const that = this
		const ownedWrappers: Partial<Record<TimeoutTypes, typeof setTimeout | typeof setInterval>> = {}
		const wrapFn = (originalSetTimeout: typeof setTimeout | typeof setInterval, name: TimeoutTypes) => {
			return function (this: any, ...args: any) {
				const timer = originalSetTimeout.apply(this, args)
				if (!that._active) return timer
				// 定期移除已完成句柄并限制容量，避免监控本身导致长期运行的内存增长。
				that.get()
				if (that._timeoutMap.size >= 1000) {
					that._dropped++
					return timer
				}
				// 定位只读取包装函数与创建者两帧，额外帧不会进入结果却增加每次创建的 VM 成本。
				const readStack = captureStackFilePath(name, 2)
				const data = {
					timer: timer as any as Timer,
					name,
					get stack() {
						return readStack()
					},
				}
				that._timeoutMap.set(++id, data)
				return timer
			} as typeof setTimeout
		}

		TIMEOUTS.forEach((name) => {
			// we have to restore the name of current function we wrapped, because  prepareStackTrace will retrieve it on stacks
			// name is enumerable that we assign it in the wrap
			ownedWrappers[name] = wrap(global, name, wrapFn)
		})
		return () => {
			this._active = false
			// 后安装的第三方可能仍引用 SDK 中间层；保留其包装，旧 SDK 层只透明转发。
			TIMEOUTS.forEach((name) => {
				if (global[name] === ownedWrappers[name]) unwrap(global, name)
			})
		}
	}

	public get(): TimeoutData {
		for (const [id, info] of this._timeoutMap) {
			if (info.timer._destroyed) this._timeoutMap.delete(id)
		}
		return this._timeoutMap
	}

	destroy(): void {
		// unwrap setTimeout and setInterval
		super.destroy()
		this._timeoutMap.clear()
	}
}

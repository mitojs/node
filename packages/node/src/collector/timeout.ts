import { BaseCollector } from './base'

type TimeoutTypes = 'setTimeout' | 'setInterval'
const TIMER_DESTROYED_KEY = '_destroyed'

type TimeoutInfo = {
	name: TimeoutTypes
	stack: string
	timer: NodeJS.Timer & {
		[TIMER_DESTROYED_KEY]: boolean
	}
}
export interface TimeoutData {
	timeoutMap: Map<number, TimeoutInfo>
}

export class TimeoutCollector extends BaseCollector<TimeoutData> {
	private _timeoutMap: Map<
		number,
		{
			name: TimeoutTypes
			stack: string
			timer: NodeJS.Timer & {
				[TIMER_DESTROYED_KEY]: boolean
			}
		}
	> = new Map()

	hook() {
		// 劫持 setTimeout 和 setInterval 并将
		return () => {
			// 还原劫持
		}
	}

	public get(): TimeoutData {
		return {
			timeoutMap: this._timeoutMap,
		}
	}

	destroy(): void {
		this._timeoutMap.clear()
	}
}

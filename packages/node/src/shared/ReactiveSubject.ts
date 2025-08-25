import { type Observer, Subject, type Subscription } from 'rxjs'

/**
 * Building relationships with current instance of Client.
 * Making it reactive that can GC and remove subject automatically when invoke client.destroy() or subscription.unsubscribe().
 *
 * @class ReactiveSubject
 * @extends {Subject<T>}
 * @template T
 */
export class ReactiveSubject<T> extends Subject<T> {
	tearDownFns: (() => void)[] = []

	/**
	 * @description rewrite subject.subscribe that to have some pre-operation.
	 * Like intercept "unsubscribe" to check observed after each call and push subscription to Client._subscriptions
	 *
	 * @param {(Partial<Observer<T>> | ((value: T) => void) | null)} [observerOrNext]
	 * @param {MiniProgramClient} [client]
	 * @return {*}  {Subscription}
	 * @memberof ReactiveSubject
	 */
	subscribe(observerOrNext?: Partial<Observer<T>> | ((value: T) => void) | null): Subscription {
		const subscription = super.subscribe(observerOrNext as any)
		// unsubscribe current subject if subscribers change from greater than 0 to equal to 0
		const unsubscribeDetective = () => !this.observed && this.unsubscribe()

		const originalUnsubscribe = subscription.unsubscribe
		subscription.unsubscribe = function (this: any, ...args: any) {
			originalUnsubscribe.apply(this, args)
			// must be checked "observed" after original unsubscribe
			unsubscribeDetective()
		}

		return subscription
	}

	/**
	 * @description run tearDownFns after unsubscribe
	 *
	 * @memberof ReactiveSubject
	 */
	unsubscribe(): void {
		super.unsubscribe()
		// need remove subscription from client._subscriptions
		this.tearDownFns.forEach((fn) => fn())
	}

	/**
	 *@description add tearDownFns
	 *
	 * @param {() => void} fn
	 * @memberof ReactiveSubject
	 */
	addTearDown(fn: () => void) {
		this.tearDownFns.push(fn)
	}
}

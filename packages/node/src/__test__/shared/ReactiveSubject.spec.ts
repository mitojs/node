import { ReactiveSubject } from '../../shared/ReactiveSubject'

describe('ReactiveSubject', () => {
	it('runs teardown functions when the last subscription is removed', () => {
		const subject = new ReactiveSubject<number>()
		const teardown = jest.fn()

		subject.addTearDown(teardown)
		const subscription = subject.subscribe(() => {})

		subscription.unsubscribe()

		expect(teardown).toHaveBeenCalledTimes(1)
		expect(subject.closed).toBe(true)
	})
})

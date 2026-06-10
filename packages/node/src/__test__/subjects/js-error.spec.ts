import { JSErrorSubject } from '../../subjects/js-error'

describe('JSErrorSubject', () => {
	let subject: JSErrorSubject

	afterEach(() => {
		subject?.unsubscribe()
	})

	it('emits collector errors through the subject stream', () => {
		subject = new JSErrorSubject()
		const subscriber = jest.fn()
		const error = new Error('boom')

		subject.subscribe(subscriber)
		process.emit('uncaughtException', error)

		expect(subscriber).toHaveBeenCalledWith(error)
	})
})

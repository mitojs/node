import { SubjectNames } from '../../shared'
import { TimeoutSubject } from '../../subjects/timeout'

describe('TimeoutSubject', () => {
	let subject: TimeoutSubject

	afterEach(() => {
		subject?.unsubscribe()
	})

	it('uses the timeout subject name', () => {
		subject = new TimeoutSubject()

		expect(subject.getSubjectName()).toBe(SubjectNames.Timeout)
	})

	it('collects active timeout records', () => {
		subject = new TimeoutSubject()

		const timeout = setTimeout(() => {}, 1000)
		const data = subject.getCollector()?.get()

		expect(data?.size).toBe(1)
		expect(data?.get(1)?.name).toBe('setTimeout')

		clearTimeout(timeout)
	})
})

import type { BaseCollector } from '../collector/base'
import { JsErrorCollector } from '../collector/js-error'
import { logger, SubjectNames } from '../shared'
import { BaseMonitoringSubject } from './base'

export class JSErrorSubject extends BaseMonitoringSubject<Error> {
	constructor(options?: { interval: number }) {
		super(options)
		this.collector?.subscribe?.((error) => {
			this.next(error)
		})
	}

	protected createCollector(): BaseCollector<Error> {
		return new JsErrorCollector()
	}

	getSubjectName() {
		return SubjectNames.JSError
	}

	// JS errors are pushed by process event listeners, so this subject does not need polling.
	start() {
		if (this.closed) {
			logger.error(`${this.getSubjectName()} start error, subject is closed`)
		}
	}
}

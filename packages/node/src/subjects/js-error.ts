import type { BaseCollector } from '../collector/base'
import { JsErrorCollector } from '../collector/js-error'
import { SubjectNames } from '../shared'
import { BaseMonitoringSubject } from './base'

export class JSErrorSubject extends BaseMonitoringSubject<Error> {
	protected createCollector(): BaseCollector<Error> {
		return new JsErrorCollector()
	}

	getSubjectName() {
		return SubjectNames.JSError
	}
}

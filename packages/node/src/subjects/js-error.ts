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

	// JS Error 通过事件监听实时推送，不需要 setInterval 轮询
	start() {
		const collector = this.collector as JsErrorCollector
		collector.subscribe((err: Error) => {
			this.next(err)
		})
	}
}

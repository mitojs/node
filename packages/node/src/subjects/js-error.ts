import type { BaseCollector } from '../collector/base'
import { JsErrorCollector } from '../collector/js-error'
import { logger, SubjectNames } from '../shared'
import { BaseMonitoringSubject } from './base'

export class JSErrorSubject extends BaseMonitoringSubject<Error> {
	protected createCollector(): BaseCollector<Error> {
		return new JsErrorCollector()
	}

	getSubjectName() {
		return SubjectNames.JSError
	}

	// 重写start方法，JS-Error SUbject不需要轮询，通过事件监听实时通知
	start() {
		logger.error('JSErrorSubject.start() is not needed, errors are notified in real-time via event listeners')
	}
}

import type { BaseCollector } from '../collector/base'
import { TimeoutCollector, type TimeoutData } from '../collector/timeout'
import { SubjectNames } from '../shared'
import { BaseMonitoringSubject } from './base'

export class TimeoutSubject extends BaseMonitoringSubject<TimeoutData> {
	protected createCollector(): BaseCollector<TimeoutData> {
		return new TimeoutCollector()
	}

	getSubjectName() {
		return SubjectNames.Timeout
	}
}

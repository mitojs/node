import type { BaseCollector } from '../collector/base'
import { CPUCollector, type CPUData } from '../collector/cpu'
import { SubjectNames } from '../shared'
import { BaseMonitoringSubject } from './base'

export class CPUSubject extends BaseMonitoringSubject<CPUData> {
	protected createCollector(): BaseCollector<CPUData> {
		return new CPUCollector()
	}

	getSubjectName() {
		return SubjectNames.CPU
	}
}

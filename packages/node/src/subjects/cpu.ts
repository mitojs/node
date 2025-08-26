import type { BaseCollector } from '../collector/base'
import { CPUCollector, type CPUData } from '../collector/cpu'
import { BaseMonitoringSubject } from './base'

export class CPUSubject extends BaseMonitoringSubject<CPUData> {
	protected createCollector(): BaseCollector<CPUData> {
		return new CPUCollector()
	}

	protected getSubjectName(): string {
		return 'CPUSubject'
	}
}

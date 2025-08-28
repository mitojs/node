import type { BaseCollector } from '../collector/base'
import { MemoryCollector, type MemoryData } from '../collector/memory'
import { SubjectNames } from '../shared'
import { BaseMonitoringSubject } from './base'

export class MemorySubject extends BaseMonitoringSubject<MemoryData> {
	protected createCollector(): BaseCollector<MemoryData> {
		return new MemoryCollector()
	}

	getSubjectName() {
		return SubjectNames.Memory
	}
}

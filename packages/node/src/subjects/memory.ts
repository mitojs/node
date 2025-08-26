import type { BaseCollector } from '../collector/base'
import { MemoryCollector, type MemoryData } from '../collector/memory'
import { BaseMonitoringSubject } from './base'

export class MemorySubject extends BaseMonitoringSubject<MemoryData> {
	protected createCollector(): BaseCollector<MemoryData> {
		return new MemoryCollector()
	}

	protected getSubjectName(): string {
		return 'MemorySubject'
	}
}

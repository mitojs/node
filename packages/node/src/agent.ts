import { configMap } from './config'
import { recordMetricToAgent } from './request'
import { SubjectNames } from './shared'
import type { RecordMetricData } from './types'

export type AgentMetricType = 'cpu' | 'memory' | 'js_error' | 'timeout'

interface MetricSenderDeps {
	recordMetricToAgent: (data: RecordMetricData) => Promise<unknown>
}

const defaultDeps: MetricSenderDeps = {
	recordMetricToAgent,
}

export function toAgentMetricType(subjectName: SubjectNames): AgentMetricType | null {
	switch (subjectName) {
		case SubjectNames.CPU:
			return 'cpu'
		case SubjectNames.Memory:
			return 'memory'
		case SubjectNames.JSError:
			return 'js_error'
		case SubjectNames.Timeout:
			return 'timeout'
		default:
			return null
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

export function normalizeMetricData(data: unknown): unknown {
	if (data instanceof Error) {
		return {
			name: data.name,
			message: data.message,
			stack: data.stack,
		}
	}

	if (data instanceof Map) {
		return Array.from(data.entries()).map(([id, value]) => {
			const timeoutInfo = isRecord(value) ? value : {}
			const timer = isRecord(timeoutInfo.timer) ? timeoutInfo.timer : {}

			return {
				id,
				name: timeoutInfo.name,
				stack: timeoutInfo.stack,
				destroyed: Boolean(timer._destroyed),
			}
		})
	}

	return data
}

export async function sendMetricToAgent(
	subjectName: SubjectNames,
	data: unknown,
	deps: MetricSenderDeps = defaultDeps
) {
	const metricType = toAgentMetricType(subjectName)
	if (!metricType) {
		return {
			sent: false,
			reason: 'unsupported_subject' as const,
		}
	}

	await deps.recordMetricToAgent({
		process_id: configMap.get('pid'),
		metric_type: metricType,
		data: normalizeMetricData(data),
	})

	return {
		sent: true,
	}
}

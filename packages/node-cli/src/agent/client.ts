import http from 'node:http'
import type { AgentClientOptions, AgentInfo, AgentMetricSnapshot, AgentProcessSnapshot } from './types.js'

export interface AgentHttpDeps {
	requestJson: (url: string, timeout: number) => Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function requireString(value: Record<string, unknown>, key: string) {
	const field = value[key]
	if (typeof field !== 'string') {
		throw new Error(`Invalid agent response: ${key} must be a string`)
	}

	return field
}

function requireNumber(value: Record<string, unknown>, key: string) {
	const field = value[key]
	if (typeof field !== 'number') {
		throw new Error(`Invalid agent response: ${key} must be a number`)
	}

	return field
}

function toAgentInfo(value: unknown): AgentInfo {
	if (!isRecord(value)) {
		throw new Error('Invalid agent response: /info must return an object')
	}

	return {
		name: requireString(value, 'name'),
		version: requireString(value, 'version'),
		status: requireString(value, 'status'),
	}
}

function toMetricSnapshot(value: unknown): AgentMetricSnapshot {
	if (!isRecord(value)) {
		throw new Error('Invalid agent response: latest_metrics items must be objects')
	}

	return {
		metric_type: requireString(value, 'metric_type'),
		data: value.data,
		recorded_at: requireNumber(value, 'recorded_at'),
	}
}

function toProcessSnapshot(value: unknown): AgentProcessSnapshot {
	if (!isRecord(value)) {
		throw new Error('Invalid agent response: /processes items must be objects')
	}

	const proxyPort = value.proxy_port ?? value.uds_port
	const latestMetrics = value.latest_metrics
	if (proxyPort !== null && typeof proxyPort !== 'number') {
		throw new Error('Invalid agent response: proxy_port must be a number or null')
	}
	if (!Array.isArray(latestMetrics)) {
		throw new Error('Invalid agent response: latest_metrics must be an array')
	}

	return {
		process_id: requireNumber(value, 'process_id'),
		proxy_port: proxyPort,
		latest_heartbeat_time: requireNumber(value, 'latest_heartbeat_time'),
		latest_metrics: latestMetrics.map(toMetricSnapshot),
	}
}

function requestJson(url: string, timeout: number) {
	return new Promise<unknown>((resolve, reject) => {
		const request = http.get(url, (response) => {
			let body = ''

			response.setEncoding('utf8')
			response.on('data', (chunk: string) => {
				body += chunk
			})
			response.on('end', () => {
				if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
					reject(new Error(`Agent request failed: ${response.statusCode ?? 'unknown status'}`))
					return
				}

				try {
					resolve(JSON.parse(body))
				} catch (error) {
					reject(error)
				}
			})
		})

		request.setTimeout(timeout, () => {
			request.destroy(new Error(`Agent request timed out after ${timeout}ms`))
		})
		request.on('error', reject)
	})
}

const defaultDeps: AgentHttpDeps = {
	requestJson,
}

function agentUrl(options: AgentClientOptions, path: string) {
	return `http://${options.host}:${options.port}${path}`
}

export async function getAgentInfo(options: AgentClientOptions, deps: AgentHttpDeps = defaultDeps) {
	return toAgentInfo(await deps.requestJson(agentUrl(options, '/info'), options.timeout))
}

export async function listAgentProcesses(options: AgentClientOptions, deps: AgentHttpDeps = defaultDeps) {
	const response = await deps.requestJson(agentUrl(options, '/processes'), options.timeout)
	if (!Array.isArray(response)) {
		throw new Error('Invalid agent response: /processes must return an array')
	}

	return response.map(toProcessSnapshot)
}

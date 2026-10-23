import { configMap } from './config'
import { easyFetch, type FetchOptions } from './shared/utils'
import type { RegisterProcessData } from './types'

export class AgentRequestError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message)
	}
}

// 所有请求有时间上限，4xx 不重试，避免未注册 PID 等永久错误制造后台请求风暴。
export async function requestToAgent<T>(path: string, options: FetchOptions = {}): Promise<T> {
	const url = `http://${configMap.get('agentHost')}:${configMap.get('agentTCPPort')}${path}`
	for (let attempt = 0; ; attempt++) {
		try {
			const response = await easyFetch(url, { timeout: 1000, ...options })
			if (response.status < 200 || response.status >= 300)
				throw new AgentRequestError(`Agent HTTP ${response.status}`, response.status)
			const data = await response.json()
			if (data.success === false) throw new AgentRequestError(data.message || 'Agent rejected request')
			return data as T
		} catch (error) {
			if (
				options.signal?.aborted ||
				attempt >= 1 ||
				(error instanceof AgentRequestError && error.status && error.status < 500)
			)
				throw error
		}
	}
}

export function registerProcessToAgent(data: RegisterProcessData, signal?: AbortSignal) {
	return requestToAgent('/ipc/register_process', { method: 'POST', body: JSON.stringify(data), signal })
}
export function unregisterProcessFromAgent(signal?: AbortSignal) {
	return requestToAgent('/ipc/unregister_process', {
		method: 'POST',
		body: JSON.stringify({ pid: process.pid }),
		signal,
	})
}
export function heartbeatToAgent(signal?: AbortSignal) {
	return requestToAgent('/heartbeat', { method: 'POST', body: JSON.stringify({ process_id: process.pid }), signal })
}

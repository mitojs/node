import { configMap } from './config'
import { easyFetch, type FetchOptions, retry } from './shared/utils'
import type { RegisterProcessData } from './types'

const getAgentRequestBasePath = () => `http://${configMap.get('agentHost')}:${configMap.get('agentTCPPort')}`

const AGENT_REQUEST_REGISTER_PROCESS_PATH = '/ipc/register_process'
const AGENT_REQUEST_UPDATE_PROCESS_PATH = '/ipc/update_process'
const AGENT_REQUEST_GET_UDS_PATH = '/ipc/get_uds_path'

export async function requestToAgent<T>(path: string, options: FetchOptions) {
	return retry<T>(async () => {
		const res = await easyFetch(`${getAgentRequestBasePath()}${path}`, options)
		return await res.json()
	})
}

export async function registerProcessToAgent(data: RegisterProcessData) {
	return requestToAgent<{ code: number; message: string }>(AGENT_REQUEST_REGISTER_PROCESS_PATH, {
		method: 'POST',
		body: JSON.stringify(data),
	})
}

export async function updateProcessToAgent(data: RegisterProcessData) {
	return requestToAgent<{ code: number; message: string }>(AGENT_REQUEST_UPDATE_PROCESS_PATH, {
		method: 'POST',
		body: JSON.stringify(data),
	})
}

export async function getUDSPathFromAgent() {
	return requestToAgent<{ code: number; message: string; data: { uds_path: string } }>(AGENT_REQUEST_GET_UDS_PATH, {
		method: 'GET',
	})
}

import { parentPort, threadId, workerData } from 'node:worker_threads'
import { createHttpServer, DEFAULT_TCP_PORT, IpcMessageCode } from '../shared'

;(async () => {
	const http = await createHttpServer(DEFAULT_TCP_PORT + 1)
	console.log('http', http.address())
	//
	parentPort?.postMessage({
		code: IpcMessageCode.Ok,
	})
})()

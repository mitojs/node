import type http from 'node:http'
import { parentPort, workerData } from 'node:worker_threads'
import { createHttpServer, DEFAULT_TCP_PORT, IpcMessageCode, logger } from '../shared'

function parseBody(req: http.IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		const chunks: Uint8Array[] = []
		req.on('data', (chunk: Uint8Array) => chunks.push(chunk))
		req.on('end', () => {
			try {
				const body = Buffer.concat(chunks).toString()
				resolve(body ? JSON.parse(body) : {})
			} catch (e) {
				reject(e)
			}
		})
		req.on('error', reject)
	})
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
	const url = req.url || '/'
	const method = req.method || 'GET'

	if (method === 'GET' && url === '/health') {
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ status: 'ok', pid: process.pid }))
		return
	}

	if (method === 'POST' && url === '/command/cpu-profile') {
		parseBody(req)
			.then((body) => {
				const duration = body.duration || 10000
				logger.info(`收到 CPU Profile 指令, duration=${duration}ms`)
				// 通过 parentPort 通知主线程执行 CPU Profile
				parentPort?.postMessage({ type: 'command', command: 'cpu-profile', params: { duration } })
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ success: true, message: 'CPU profile started' }))
			})
			.catch((e) => {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ success: false, error: e.message }))
			})
		return
	}

	if (method === 'POST' && url === '/command/heap-snapshot') {
		logger.info('收到 Heap Snapshot 指令')
		parentPort?.postMessage({ type: 'command', command: 'heap-snapshot', params: {} })
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ success: true, message: 'Heap snapshot triggered' }))
		return
	}

	if (method === 'POST' && url === '/command/evaluate') {
		parseBody(req)
			.then((body) => {
				const expression = body.expression || ''
				logger.info(`收到代码执行指令: ${expression.slice(0, 50)}...`)
				parentPort?.postMessage({ type: 'command', command: 'evaluate', params: { expression } })
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ success: true, message: 'Evaluation dispatched' }))
			})
			.catch((e) => {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ success: false, error: e.message }))
			})
		return
	}

	res.writeHead(404, { 'Content-Type': 'application/json' })
	res.end(JSON.stringify({ error: 'Not Found' }))
}

;(async () => {
	const server = await createHttpServer({
		port: DEFAULT_TCP_PORT + 1,
		onRequest: handleRequest,
	})
	logger.info(`proxy thread HTTP server: ${JSON.stringify(server.address())}`)

	parentPort?.postMessage({
		code: IpcMessageCode.Ok,
	})
})()

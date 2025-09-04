import { parentPort, threadId, workerData } from 'node:worker_threads'
import { createHttpServer, DEFAULT_TCP_PORT, IpcMessageCode } from '../shared'

/**
 * 代理线程主函数
 * 在独立的工作线程中启动 HTTP 服务器，用于与 Rust Agent 进行通信
 */
;(async () => {
	// 创建 HTTP 服务器，端口为默认端口 + 1 (16667)
	// 用于接收 Rust Agent 下发的监控指令和数据
	const http = await createHttpServer(DEFAULT_TCP_PORT + 1)
	console.log('http', http.address())

	// 向主线程发送初始化成功消息
	// 通知主线程代理服务器已成功启动
	parentPort?.postMessage({
		code: IpcMessageCode.Ok,
	})
})()

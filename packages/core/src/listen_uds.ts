import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { dirname } from 'node:path'
import { safeCallSync } from './helper.js'

const MITO_NODE = 'mito_node'

const socketPath = '~/tmp/node_apm/mito.sock'
async function main() {
	console.log('global', global)
}

async function createServerThroughUds(): Promise<null | Error> {
	const socketPath = await getSocketPath()

	if (fs.existsSync(socketPath)) {
		// 如果 socket 文件已存在，先删除它
		safeCallSync(fs.unlinkSync, socketPath)
	}

	return new Promise((resolve, reject) => {
		const errorHandler = (err: Error) => {
			// todo logger 打印错误信息
			reject(new Error(`failed to init server: ${err.message}`))
		}
		const server = net.createServer(() => {
			// 当有客户端连接时，返回 socket
			console.log('client connected')
			server.on('error', (err) => {
				// todo logger 打印错误信息
			})
		})

		server.on('error', errorHandler)
		// todo request 接收请求，后续分发给各个插件
		// server.on('request', )
		// todo upgrade 接收 websocket 协议
		// server.on('upgrade', )
		server.listen(socketPath, () => {
			server.off('error', errorHandler)
			// todo logger 打印正在监听的 uds 地址
			console.log(`UDS server listening on ${socketPath}`)
			resolve(null)
		})
	})
}

export function makeDirPromise(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		fs.mkdir(filePath, (err) => {
			err && err.code !== 'EEXIST' ? reject(new Error(`failed to mkdir: ${err.message}`)) : resolve(filePath)
		})
	})
}

async function getSocketPath() {
	try {
		return await makeDirPromise(`${process.cwd()}/${MITO_NODE}`)
	} catch (e) {
		// fallback, ie: we can not use cwd in cloud ide env
		return await makeDirPromise(`${os.tmpdir()}/${MITO_NODE}`)
	}
}

main()

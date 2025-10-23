import http from 'node:http'

const server = http.createServer()
const debugPort = 16669
server.on('request', (req, res) => {
	if (req.url === '/test') {
		res.end('test ok')
	}
})
server.listen(debugPort, () => {
	console.log('listen port', debugPort)
	// setTimeout(() => {
	// 	const req = http.request(`http://127.0.0.1:${debugPort}/test`, (res) => {
	// 		res.on('data', (chunk) => {
	// 			console.log(chunk.toString())
	// 		})
	// 	})
	// 	req.once('socket', (socket) => {
	// 		console.log('socket', socket)
	// 	})
	// 	req.end()
	// }, 100)
})
console.log('pid', process.pid)

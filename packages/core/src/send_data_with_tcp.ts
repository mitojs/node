import net from 'node:net'

function main() {
	const socket = net.connect({
		port: 12345,
		host: '127.0.0.1',
	})
	let count = 0
	setInterval(() => {
		const data = {
			type: 'data',
			data: `hello world ${count++}`,
			command_type: 'metric',
		}
		console.log(JSON.stringify(data))
		socket.write(JSON.stringify(data) + '\n')
	}, 2000)
	console.log('connected to server')
}

main()

import net from 'node:net'

function main() {
	const socket = net.connect({
		path: '/var/folders/b1/0fd1b6hs7lz0fm_mh346lybm0000gn/T/_mito_node_.sock',
	})
	socket.on('connect', () => {
		let count = 0
		setInterval(() => {
			const data = {
				type: 'data',
				data: `hello world ${count++}`,
			}
			console.log(JSON.stringify(data))
			socket.write(JSON.stringify(data) + '\n')
		}, 2000)
		console.log('connected to server')
	})
}

main()

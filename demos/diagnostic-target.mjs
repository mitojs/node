// Reproducible local diagnostic target: the workload intentionally retains memory and timers.
import { MitoNode } from '../packages/node/dist/index.js'

const sdk = new MitoNode({
	metrics: { CPU: { interval: 250 }, Memory: { interval: 250 }, JSError: true, Timeout: true },
})
await sdk.start()
const retained = []
function cpuHotLoop() {
	const end = performance.now() + 60
	let result = 0
	while (performance.now() < end) result += Math.sqrt(Math.random())
	return result
}
const workload = setInterval(() => {
	cpuHotLoop()
	retained.push(new Array(4000).fill('diagnostic-example'))
	setTimeout(() => {}, 20000).unref()
}, 80)
console.log(
	JSON.stringify({ ready: true, pid: process.pid, agentPort: Number(process.env.MITO_AGENT_TCP_PORT) || 16666 })
)
async function stop() {
	clearInterval(workload)
	await sdk.destroy()
	process.exit(0)
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)

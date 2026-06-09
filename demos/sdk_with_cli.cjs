/**
 * Demo: 测试 @mitojs/node SDK 与 CLI 的双模通信
 *
 * 使用方式:
 * 1. 启动本 demo: node demos/sdk_with_cli.cjs
 * 2. 等待 SDK 初始化完成（约 2-3 秒）
 * 3. 在另一个终端使用 CLI 查询:
 *    node packages/node-cli/dist/cli.mjs memory -p <pid> --json
 *    - 如果 Agent 运行正常, 输出应包含 "source": "agent"
 *    - 如果 Agent 未运行, 输出应包含 "source": "inspector"
 */

const { MitoNode } = require('../packages/node/dist/index.js')

const mito = new MitoNode()

console.log(`[demo] PID: ${process.pid}`)
console.log('[demo] Starting MitoNode SDK...')

mito.start().then(() => {
	console.log('[demo] SDK started. Metrics are now streaming to Agent.')
	console.log('[demo] You can now use CLI to query this process:')
	console.log(`[demo]   node packages/node-cli/dist/cli.mjs memory -p ${process.pid} --json`)
	console.log(`[demo]   node packages/node-cli/dist/cli.mjs monitor-cpu -p ${process.pid} --json`)
	console.log('[demo] Press Ctrl+C to stop.')
})

// 模拟业务逻辑
setInterval(() => {
	const arr = []
	for (let i = 0; i < 1e5; i++) {
		arr.push({ index: i, value: Math.random() })
	}
}, 2000)

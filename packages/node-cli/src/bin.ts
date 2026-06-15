#!/usr/bin/env node
import { program } from 'commander'
import { registry } from './core/registry.js'
import { logger } from './logger.js'
import { registerBuiltinPlugins } from './plugins/index.js'
import { AgentClient } from './services/agent-client.js'
import { InspectorError, InspectorSession } from './services/inspector-session.js'
import { createOutputFormatter } from './services/output-formatter.js'

interface CmdOptions {
	pid: string
	port?: string
	json?: boolean
}

registerBuiltinPlugins()

program
	.option('-p, --pid <pid>', 'process id of the target process')
	.option('--port <port>', 'inspector port of the target process', '9229')
	.option('--json', 'output in JSON format for programmatic consumption', false)

for (const plugin of registry.getAll()) {
	const command = program.command(plugin.name).description(plugin.description)
	if (plugin.options) {
		for (const opt of plugin.options) {
			if (opt.defaultValue) {
				command.option(opt.flags, opt.description, opt.defaultValue)
			} else {
				command.option(opt.flags, opt.description)
			}
		}
	}
	command.action(async (cmdOptions) => {
		const globalOpts = program.opts<CmdOptions>()
		logger.debug('process.argv', process.argv)
		logger.debug('options', globalOpts, plugin.name, cmdOptions)

		const pid = Number(globalOpts.pid)
		if (Number.isNaN(pid) || !globalOpts.pid) {
			console.error('Error: --pid is required for this command')
			process.exit(1)
		}
		try {
			process.kill(pid, 0)
		} catch {
			console.error(`Error: process ${pid} does not exist`)
			process.exit(1)
		}

		const port = Number(globalOpts.port)
		const resolvedPort = Number.isNaN(port) ? 9229 : port
		const json = globalOpts.json ?? false
		const output = createOutputFormatter(json)

		// 自动检测 Agent 是否可用
		const agentClient = new AgentClient()
		const agentAvailable = await agentClient.isAvailable()
		if (agentAvailable) {
			logger.debug('Agent detected, SDK channel available')
		}

		const session = new InspectorSession()
		try {
			await session.open(pid, resolvedPort)
			await session.connect(resolvedPort)
		} catch (e: any) {
			if (e instanceof InspectorError) {
				output({ success: false, command: plugin.name, error: e.message, errorCode: e.code, suggestion: e.suggestion })
			} else {
				output({ success: false, command: plugin.name, error: e.message })
			}
			process.exit(1)
		}

		try {
			const result = await plugin.execute(
				{ pid, port: resolvedPort, json, session, agentClient: agentAvailable ? agentClient : undefined, output },
				cmdOptions
			)
			if (result.success) {
				output({ success: true, command: plugin.name, data: result.data })
			} else {
				output({ success: false, command: plugin.name, error: result.error })
			}
		} catch (e) {
			output({ success: false, command: plugin.name, error: (e as Error).message })
		}

		// start-inspect 需要保持 Inspector 开启供 DevTools 连接，不执行 cleanup
		if (plugin.name !== 'start-inspect') {
			session.closeInspector().catch(() => {})
		}
		session.close()
		process.exit(0)
	})
}

program.parse(process.argv)

// 无子命令时自动进入 TUI 交互模式
const userArgs = process.argv.slice(2)
const hasSubcommand = registry.getAll().some((p) => userArgs.includes(p.name))
if (!userArgs.length || (!hasSubcommand && !userArgs.includes('--help') && !userArgs.includes('-h'))) {
	import('./interactive-cli.js')
}

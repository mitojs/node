#!/usr/bin/env node
import { program } from 'commander'
import { runAgentMetrics, runAgentProcesses, runAgentStatus } from './agent/agent.js'
import { toAgentMetricsOptions, toAgentOptions } from './agent/command.js'
import { formatAgentMetrics, formatAgentProcesses, formatAgentStatus } from './agent/format.js'
import { DEFAULT_AGENT_HOST, DEFAULT_AGENT_PORT, DEFAULT_AGENT_TIMEOUT } from './agent/types.js'
import { runAnalyze } from './analyze/analyze.js'
import { toAnalyzeOptions } from './analyze/command.js'
import { CLI } from './cli.js'
import { COMMAND_CONFIGS } from './constants.js'
import { discoverNodeProcesses } from './discover/discover.js'
import { formatDiscoverTable } from './discover/format.js'

program.name('mito-node')

async function printAgentResult<T>(
	options: { json?: boolean },
	action: () => Promise<T>,
	format: (result: T) => string,
	isFailure?: (result: T) => boolean
) {
	try {
		const result = await action()
		console.log(options.json ? JSON.stringify(result, null, 2) : format(result))
		if (isFailure?.(result)) {
			process.exitCode = 1
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (options.json) {
			console.log(JSON.stringify({ status: 'failed', error: message }, null, 2))
		} else {
			console.error(message)
		}
		process.exitCode = 1
	}
}

program
	.command('analyze')
	.description('analyze a target Node.js process and write a local bundle')
	.requiredOption('-p, --pid <pid>', 'process id of the target process')
	.option('--port <port>', 'inspector port of the target process', '9229')
	.option('--out-dir <dir>', 'bundle output directory')
	.option('--duration <duration>', 'cpu profile duration in milliseconds', '10000')
	.option('--json', 'print machine-readable JSON')
	.action(async (options) => {
		const result = await runAnalyze(toAnalyzeOptions(options))

		if (options.json) {
			console.log(JSON.stringify(result, null, 2))
		} else {
			console.log(`mito-node analyze ${result.status}`)
			console.log(`Bundle: ${result.bundleDir}`)
			console.log(`Read order: ${result.readOrder.join(', ')}`)
		}

		if (result.status === 'failed') {
			process.exitCode = 1
		}
	})

program
	.command('discover')
	.description('list candidate Node.js processes')
	.option('--json', 'print machine-readable JSON')
	.option('--all', 'include the current mito-node process')
	.action(async (options) => {
		const processes = await discoverNodeProcesses({ includeSelf: options.all })

		if (options.json) {
			console.log(JSON.stringify(processes, null, 2))
			return
		}

		console.log(formatDiscoverTable(processes))
	})

const agentCommand = program.command('agent').description('query a local mitojs agent')

agentCommand
	.command('status')
	.description('show local agent status')
	.option('--host <host>', 'agent host', DEFAULT_AGENT_HOST)
	.option('--port <port>', 'agent TCP port', String(DEFAULT_AGENT_PORT))
	.option('--timeout <timeout>', 'request timeout in milliseconds', String(DEFAULT_AGENT_TIMEOUT))
	.option('--json', 'print machine-readable JSON')
	.action(async (options) => {
		await printAgentResult(options, () => runAgentStatus(toAgentOptions(options)), formatAgentStatus)
	})

agentCommand
	.command('processes')
	.description('show processes registered in the local agent')
	.option('--host <host>', 'agent host', DEFAULT_AGENT_HOST)
	.option('--port <port>', 'agent TCP port', String(DEFAULT_AGENT_PORT))
	.option('--timeout <timeout>', 'request timeout in milliseconds', String(DEFAULT_AGENT_TIMEOUT))
	.option('--json', 'print machine-readable JSON')
	.action(async (options) => {
		await printAgentResult(options, () => runAgentProcesses(toAgentOptions(options)), formatAgentProcesses)
	})

agentCommand
	.command('metrics')
	.description('show latest metrics for a process registered in the local agent')
	.requiredOption('-p, --pid <pid>', 'process id')
	.option('--host <host>', 'agent host', DEFAULT_AGENT_HOST)
	.option('--port <port>', 'agent TCP port', String(DEFAULT_AGENT_PORT))
	.option('--timeout <timeout>', 'request timeout in milliseconds', String(DEFAULT_AGENT_TIMEOUT))
	.option('--json', 'print machine-readable JSON')
	.action(async (options) => {
		await printAgentResult(
			options,
			() => runAgentMetrics(toAgentMetricsOptions(options)),
			formatAgentMetrics,
			(result) => result.status === 'not_found'
		)
	})

// 遍历命令配置数组来创建命令
COMMAND_CONFIGS.forEach((config) => {
	const command = program
		.command(config.command)
		.description(config.description)
		.requiredOption('-p, --pid <pid>', 'process id of the target process')
		.option('--port <port>', 'inspector port of the target process', '9229')
	// 添加命令选项
	if (config.options) {
		config.options.forEach((option) => {
			if (option.defaultValue) {
				command.option(option.flags, option.description, option.defaultValue)
			} else {
				command.option(option.flags, option.description)
			}
		})
	}

	// 添加命令动作
	command.action((options) => {
		const cli = new CLI({
			pid: Number(options.pid),
			port: Number(options.port),
			cmd: {
				commandType: config.command,
				options,
			},
		})

		cli.run()
	})
})

if (process.argv.length <= 2) {
	program.help()
}

await program.parseAsync(process.argv)

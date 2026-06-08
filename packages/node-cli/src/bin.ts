#!/usr/bin/env node
import { program } from 'commander'
import { CLI } from './cli.js'
import { COMMAND_CONFIGS } from './constants.js'
import { logger } from './logger.js'
import type { AllCommandOptions } from './types/commands.js'

interface CmdOptions {
	pid: string
	port?: string
	json?: boolean
}

let inputCmd!: AllCommandOptions

program
	.requiredOption('-p, --pid <pid>', 'process id of the target process')
	.option('--port <port>', 'inspector port of the target process', '9229')
	.option('--json', 'output in JSON format for programmatic consumption', false)

// 遍历命令配置数组来创建命令
COMMAND_CONFIGS.forEach((config) => {
	const command = program.command(config.command).description(config.description)
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
		inputCmd = {
			commandType: config.command,
			options,
		}
	})
})

program.parse(process.argv)

const options = program.opts<CmdOptions>()

logger.debug('process.argv', process.argv)
logger.debug('options', options, inputCmd)

const pid = Number(options.pid)
if (Number.isNaN(pid)) {
	console.error('Error: --pid must be a valid number')
	process.exit(1)
}
try {
	process.kill(pid, 0)
} catch {
	console.error(`Error: process ${pid} does not exist`)
	process.exit(1)
}

const port = Number(options.port)
const resolvedPort = Number.isNaN(port) ? 9229 : port

// 无需判断 inputCmd 是否存在，program.parse 会自动处理
const cli = new CLI({
	pid,
	port: resolvedPort,
	cmd: inputCmd,
	json: options.json,
})

cli.run()

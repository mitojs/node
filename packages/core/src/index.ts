#!/usr/bin/env node
import { program } from 'commander'
import { CLI } from './cli'
import { COMMAND_CONFIGS, type COMMAND_TYPE } from './constants'
import type { AllCommandOptions, CommandOptions } from './types/commands'

interface CmdOptions {
	pid: string
	port?: string
}

let inputCmd!: AllCommandOptions

program
	.requiredOption('-p, --pid <pid>', 'process id of the target process')
	.option('--port <port>', 'inspector port of the target process', '9229')

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
console.log('process.argv', process.argv)

const options = program.opts<CmdOptions>()

console.log('options', options, inputCmd)
// todo 检测 pid 是否存在
// todo 检测 port 是否被占用，检测 port 是否是 NaN，用默认 port

// 无需判断 inputCmd 是否存在，program.parse 会自动处理
const cli = new CLI({
	pid: Number(options.pid),
	port: Number(options.port),
	cmd: inputCmd,
})

cli.run()

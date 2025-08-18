import type { COMMAND_TYPE } from '../constants.js'
import type { AllCommandOptions, CommandOptions } from './commands.js'

// 支持 MONITOR_CPU
export interface CLIOptions<T extends COMMAND_TYPE> {
	pid: number
	port: number
	cmd: CommandOptions<T>
}

// 用于运行时的具体类型，不需要泛型，支持 MONITOR_CPU
export interface CLIRuntimeOptions {
	pid: number
	port: number
	cmd: AllCommandOptions
}

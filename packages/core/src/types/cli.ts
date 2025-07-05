import type { COMMAND_TYPE } from '../constants'
import type { AllCommandOptions, CommandOptions } from './commands'

export interface CLIOptions<T extends COMMAND_TYPE> {
	pid: number
	port: number
	cmd: CommandOptions<T>
}

// 用于运行时的具体类型，不需要泛型
export interface CLIRuntimeOptions {
	pid: number
	port: number
	cmd: AllCommandOptions
}

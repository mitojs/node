import { COMMAND_TYPE } from '../constants'

// 各个命令对应的选项类型
export interface CpuProfileOptions {
	duration: number
}

export interface HeapSnapshotOptions {
	dir?: string
}

export interface ReportOptions {
	dir?: string
}

export interface RunCodeOptions {
	file?: string
	code?: string
}

type EmptyOptions = {}

// 命令类型到选项类型的映射
export type CommandOptionsMap = {
	[COMMAND_TYPE.CPU_PROFILE]: CpuProfileOptions
	[COMMAND_TYPE.HEAP_SNAPSHOT]: HeapSnapshotOptions
	[COMMAND_TYPE.REPORT]: ReportOptions
	[COMMAND_TYPE.MEMORY]: EmptyOptions
	[COMMAND_TYPE.START_INSPECT]: EmptyOptions
	[COMMAND_TYPE.STOP_INSPECT]: EmptyOptions
	[COMMAND_TYPE.RUN_CODE]: RunCodeOptions
}

// 工具类型：根据命令类型获取对应的选项类型
export type CommandOptions<T extends COMMAND_TYPE> = {
	commandType: T
	options: CommandOptionsMap[T]
}

// 创建 discriminated union 类型，使 TypeScript 能够正确推断类型
export type AllCommandOptions =
	| CommandOptions<COMMAND_TYPE.CPU_PROFILE>
	| CommandOptions<COMMAND_TYPE.HEAP_SNAPSHOT>
	| CommandOptions<COMMAND_TYPE.REPORT>
	| CommandOptions<COMMAND_TYPE.MEMORY>
	| CommandOptions<COMMAND_TYPE.START_INSPECT>
	| CommandOptions<COMMAND_TYPE.STOP_INSPECT>
	| CommandOptions<COMMAND_TYPE.RUN_CODE>

export interface CommandConfig {
	command: COMMAND_TYPE
	description: string
	options?: {
		flags: string
		description: string
		defaultValue?: string
	}[]
}

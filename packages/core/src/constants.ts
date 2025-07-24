import type { CommandConfig } from './types/index.js';

export enum COMMAND_TYPE {
	CPU_PROFILE = 'cpuprofile',
	HEAP_SNAPSHOT = 'heapsnapshot',
	REPORT = 'report',
	MEMORY = 'memory',
	START_INSPECT = 'start-inspect',
	STOP_INSPECT = 'stop-inspect',
	RUN_CODE = 'run-code',
	MONITOR_CPU = 'monitor-cpu',
}

export enum CHROME_DEV_TASK_TYPE {
	CPU_PROFILE = 'cpu.cpuprofile',
	HEAP_PROFILE = 'cpu.heapprofile',
	HEAP_SNAPSHOT = 'heapsnapshot.heapsnapshot',
}

export const COMMAND_CONFIGS: CommandConfig[] = [
	{
		command: COMMAND_TYPE.CPU_PROFILE,
		description: 'get cpuprofile of the target process',
		options: [
			{
				flags: '-d, --duration <duration>',
				description: 'cpuprofile duration',
				defaultValue: '10000',
			},
		],
	},
	{
		command: COMMAND_TYPE.HEAP_SNAPSHOT,
		description: 'get heapsnapshot of the target process',
		options: [
			{
				flags: '-d, --dir <dir>',
				description: 'heapsnapshot file store dir',
				defaultValue: '.',
			},
		],
	},
	{
		command: COMMAND_TYPE.REPORT,
		description: 'get report of the target process',
		options: [
			{
				flags: '-d, --dir <dir>',
				description: 'report file store dir',
				defaultValue: '.',
			},
		],
	},
	{
		command: COMMAND_TYPE.MEMORY,
		description: 'get memory info of the target process',
	},
	{
		command: COMMAND_TYPE.START_INSPECT,
		description: 'start inspect the target process',
	},
	{
		command: COMMAND_TYPE.STOP_INSPECT,
		description: 'stop inspect the target process',
	},
	{
		command: COMMAND_TYPE.RUN_CODE,
		description: 'run code in the target process',
		options: [
			{
				flags: '-f, --file <code>',
				description: 'run code from file',
			},
			{
				flags: '-c, --code <code>',
				description: 'run code from string',
			},
		],
	},
	{
		command: COMMAND_TYPE.MONITOR_CPU,
		description: 'Real-time monitor CPU usage of the target process',
	},
]

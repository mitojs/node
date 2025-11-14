#!/usr/bin/env node
import { Box, type Key, render, Text, useApp, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { CLI } from './cli.js'
import { COMMAND_CONFIGS, COMMAND_TYPE } from './constants.js'
import { getNodeProcesses, type NodeProcess } from './shared/command.js'
import { Steps } from './types/cli.js'
import type { AllCommandOptions, CommandOptionsMap } from './types/commands.js'

// 常量定义
const DEFAULT_PORT = 9229

interface AppState {
	step: Steps
	processes: NodeProcess[]
	selectedPidIndex: number
	selectedPid: number | null
	selectedCommandIndex: number
	selectedCommand: COMMAND_TYPE | null
	error: string | null
	executionStatus: 'idle' | 'running' | 'success' | 'error'
}

function InteractiveCLI() {
	const { exit } = useApp()
	const [state, setState] = useState<AppState>({
		step: Steps.SelectPid,
		processes: [],
		selectedPidIndex: 0,
		selectedPid: null,
		selectedCommandIndex: 0,
		selectedCommand: null,
		error: null,
		executionStatus: 'idle',
	})

	// 获取Node进程列表
	const fetchProcesses = () => {
		try {
			const processes = getNodeProcesses()
			if (processes.length === 0) {
				setState((prev) => ({ ...prev, error: '未找到任何 Node.js 进程' }))
			} else {
				setState((prev) => ({
					...prev,
					processes,
					// 重置选中索引，避免数组越界
					selectedPidIndex: Math.min(prev.selectedPidIndex, processes.length - 1),
				}))
			}
		} catch (error) {
			setState((prev) => ({
				...prev,
				error: `获取进程列表失败: ${(error as Error).message}`,
			}))
		}
	}

	// 初始化时获取进程列表
	// biome-ignore lint/correctness/useExhaustiveDependencies: 不需要依赖
	useEffect(() => {
		fetchProcesses()
	}, [])

	// 处理键盘输入
	useInput((input, key) => {
		// 退出操作
		if (key.escape || (key.ctrl && input === 'c')) {
			exit()
			return
		}

		// 命令执行完成后的处理
		if (state.executionStatus === 'success' || state.executionStatus === 'error') {
			if (key.return) {
				// 返回命令选择界面
				setState((prev) => ({
					...prev,
					step: Steps.SelectCommand,
					executionStatus: 'idle',
					error: null,
				}))
			} else if (key.backspace) {
				// 返回进程选择界面
				setState((prev) => ({
					...prev,
					step: Steps.SelectPid,
					selectedCommandIndex: 0,
					executionStatus: 'idle',
					error: null,
				}))
			}
			return
		}

		// 进程选择阶段
		if (state.step === Steps.SelectPid) {
			handlePidSelectionInput(key, input)
		}
		// 命令选择阶段
		else if (state.step === Steps.SelectCommand) {
			handleCommandSelectionInput(key, input)
		}
	})

	// 处理进程选择输入
	const handlePidSelectionInput = (key: Key, input: string) => {
		if (key.upArrow) {
			setState((prev) => ({
				...prev,
				selectedPidIndex: prev.selectedPidIndex === 0 ? prev.processes.length - 1 : prev.selectedPidIndex - 1,
				error: null,
			}))
		} else if (key.downArrow) {
			setState((prev) => ({
				...prev,
				selectedPidIndex: prev.selectedPidIndex === prev.processes.length - 1 ? 0 : prev.selectedPidIndex + 1,
				error: null,
			}))
		} else if (key.return) {
			const selectedProcess = state.processes[state.selectedPidIndex]
			if (selectedProcess) {
				setState((prev) => ({
					...prev,
					selectedPid: selectedProcess.pid,
					step: Steps.SelectCommand,
					error: null,
				}))
			}
		}
		// 刷新进程列表
		else if (input === 'r' || input === 'R') {
			fetchProcesses()
		}
	}

	// 处理命令选择输入
	const handleCommandSelectionInput = (key: Key, input: string) => {
		if (key.upArrow) {
			setState((prev) => ({
				...prev,
				selectedCommandIndex:
					prev.selectedCommandIndex === 0 ? COMMAND_CONFIGS.length - 1 : prev.selectedCommandIndex - 1,
				error: null,
			}))
		} else if (key.downArrow) {
			setState((prev) => ({
				...prev,
				selectedCommandIndex:
					prev.selectedCommandIndex === COMMAND_CONFIGS.length - 1 ? 0 : prev.selectedCommandIndex + 1,
				error: null,
			}))
		} else if (key.return) {
			const selectedConfig = COMMAND_CONFIGS[state.selectedCommandIndex]
			if (selectedConfig) {
				setState((prev) => ({
					...prev,
					selectedCommand: selectedConfig.command,
					step: Steps.Running,
					executionStatus: 'running',
					error: null,
				}))

				// 执行选中的命令
				executeCommand(state.selectedPid!, selectedConfig.command)
			}
		} else if (key.backspace) {
			setState((prev) => ({
				...prev,
				step: Steps.SelectPid,
				selectedCommandIndex: 0,
				error: null,
			}))
		}
	}

	// 创建命令选项
	const createCommandOptions = <T extends COMMAND_TYPE>(commandType: T): CommandOptionsMap[T] => {
		const commandConfig = COMMAND_CONFIGS.find((config) => config.command === commandType)

		// 默认选项对象
		const defaultOptions: Partial<CommandOptionsMap[T]> = {}

		// 如果有配置的默认选项，应用它们
		if (commandConfig?.options) {
			commandConfig.options.forEach((option) => {
				if (option.defaultValue) {
					// 从flags中提取选项名（例如从'-d, --duration <duration>'中提取'duration'）
					const optionName = option.flags
						.split(',')
						.find((flag) => flag.includes('--'))
						?.split('--')[1]
						.split('<')[0]
						.trim()

					if (optionName) {
						// 尝试转换为数字
						defaultOptions[optionName] = !isNaN(Number(option.defaultValue))
							? Number(option.defaultValue)
							: option.defaultValue
					}
				}
			})
		}

		// 特殊处理
		switch (commandType) {
			case COMMAND_TYPE.CPU_PROFILE:
				return { duration: 10000 } as CommandOptionsMap[T]
			case COMMAND_TYPE.RUN_CODE:
				return { code: 'console.log("Hello from injected code!")' } as CommandOptionsMap[T]
			default:
				return defaultOptions as CommandOptionsMap[T]
		}
	}

	// 执行命令
	const executeCommand = async (pid: number, commandType: COMMAND_TYPE) => {
		try {
			// 使用重构后的函数创建命令选项
			const options = createCommandOptions(commandType)

			const commandOptions = {
				commandType,
				options,
			} as AllCommandOptions

			const cli = new CLI({
				pid,
				port: DEFAULT_PORT,
				cmd: commandOptions,
			})

			await cli.run()

			// 命令执行成功
			setState((prev) => ({
				...prev,
				executionStatus: 'success',
				error: null,
			}))
		} catch (error) {
			// 命令执行失败
			setState((prev) => ({
				...prev,
				error: `执行命令失败: ${(error as Error).message}`,
				executionStatus: 'error',
			}))
		}
	}

	// 错误界面
	if (state.error && state.executionStatus !== 'error') {
		return (
			<Box flexDirection='column'>
				<Text color='red'>错误: {state.error}</Text>
				<Text color='gray'>按 ESC 或 Ctrl+C 退出，R 键刷新进程列表</Text>
			</Box>
		)
	}

	// 进程选择界面
	if (state.step === Steps.SelectPid) {
		return (
			<Box flexDirection='column'>
				<Text color='cyan' bold>
					请选择要分析的 Node.js 进程:
				</Text>
				<Text color='gray'>使用 ↑↓ 键选择，回车确认，R 键刷新，ESC 退出</Text>
				<Text> </Text>

				{/* 表头 */}
				<Text color='blue' bold>
					{'  '}
					{'PID'.padEnd(8)}
					{'PPID'.padEnd(8)}
					{'STIME'.padEnd(10)}
					{'TIME'.padEnd(12)}
					{'COMMAND'}
				</Text>
				<Text color='gray'>
					{'  '}
					{'─'.repeat(8)}
					{'─'.repeat(8)}
					{'─'.repeat(10)}
					{'─'.repeat(12)}
					{'─'.repeat(50)}
				</Text>

				{/* 进程列表 */}
				{state.processes.map((process, index) => (
					<Box key={process.pid}>
						<Text color={index === state.selectedPidIndex ? 'green' : 'white'}>
							{index === state.selectedPidIndex ? '► ' : '  '}
							{process.pid.toString().padEnd(8)}
							{process.ppid.toString().padEnd(8)}
							{process.stime.padEnd(10)}
							{process.time.padEnd(12)}
							{process.command}
						</Text>
					</Box>
				))}
			</Box>
		)
	}

	// 命令选择界面
	if (state.step === Steps.SelectCommand) {
		return (
			<Box flexDirection='column'>
				<Text color='cyan' bold>
					已选择进程 PID: {state.selectedPid}
				</Text>
				<Text color='cyan' bold>
					请选择要执行的命令:
				</Text>
				<Text color='gray'>使用 ↑↓ 键选择，回车确认，Backspace 返回，ESC 退出</Text>
				<Text> </Text>
				{COMMAND_CONFIGS.map((config, index) => (
					<Box key={config.command} flexDirection='column'>
						<Text color={index === state.selectedCommandIndex ? 'green' : 'white'}>
							{index === state.selectedCommandIndex ? '► ' : '  '}
							{config.command} - {config.description}
						</Text>
					</Box>
				))}
			</Box>
		)
	}

	// 命令执行界面
	if (state.step === Steps.Running) {
		// 运行中状态
		if (state.executionStatus === 'running') {
			return (
				<Box flexDirection='column'>
					<Text color='yellow'>正在执行命令: {state.selectedCommand}</Text>
					<Text color='yellow'>目标进程 PID: {state.selectedPid}</Text>
					<Text color='gray'>请等待...</Text>
					<Text color='gray'>(按 Ctrl+C 强制退出)</Text>
				</Box>
			)
		}

		// 成功状态
		if (state.executionStatus === 'success') {
			return (
				<Box flexDirection='column'>
					<Text color='green'>命令执行成功: {state.selectedCommand}</Text>
					<Text color='green'>目标进程 PID: {state.selectedPid}</Text>
					<Text> </Text>
					<Text color='gray'>按回车返回命令选择</Text>
					<Text color='gray'>按 Backspace 返回进程选择</Text>
					<Text color='gray'>按 ESC 或 Ctrl+C 退出</Text>
				</Box>
			)
		}

		// 错误状态
		if (state.executionStatus === 'error' && state.error) {
			return (
				<Box flexDirection='column'>
					<Text color='red'>命令执行失败: {state.selectedCommand}</Text>
					<Text color='red'>错误: {state.error}</Text>
					<Text> </Text>
					<Text color='gray'>按回车返回命令选择</Text>
					<Text color='gray'>按 Backspace 返回进程选择</Text>
					<Text color='gray'>按 ESC 或 Ctrl+C 退出</Text>
				</Box>
			)
		}
	}

	return null
}

// 如果直接运行此文件，则启动交互式 CLI
if (import.meta.url === `file://${process.argv[1]}`) {
	render(<InteractiveCLI />)
}

export default InteractiveCLI

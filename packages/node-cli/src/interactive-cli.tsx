#!/usr/bin/env node
import { execSync } from 'child_process'
import { Box, render, Text, useApp, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { CLI } from './cli.js'
import { COMMAND_CONFIGS, COMMAND_TYPE } from './constants.js'
import { Steps } from './types/cli.js'
import type { AllCommandOptions } from './types/commands.js'

interface NodeProcess {
	pid: number
	ppid: number
	stime: string
	time: string
	command: string
}

interface AppState {
	step: Steps
	processes: NodeProcess[]
	selectedPidIndex: number
	selectedPid: number | null
	selectedCommandIndex: number
	selectedCommand: COMMAND_TYPE | null
	error: string | null
}

function getNodeProcesses(): NodeProcess[] {
	try {
		// 使用 pgrep 获取 Node.js 进程 PID，然后用 ps 获取详细信息
		const pids = execSync('pgrep node', { encoding: 'utf8' }).trim()
		if (!pids) {
			return []
		}

		const output = execSync(`ps -fxp ${pids.split('\n').join(' ')}`, { encoding: 'utf8' })
		const lines = output.trim().split('\n').slice(1) // 跳过标题行

		return lines
			.map((line) => {
				const parts = line.trim().split(/\s+/)
				const pid = parseInt(parts[1])
				const ppid = parseInt(parts[2])
				const stime = parts[4]
				const time = parts[6]
				const command = parts.slice(7).join(' ') // ps -f 格式中命令从第8列开始

				return { pid, ppid, stime, time, command }
			})
			.filter((proc) => proc.pid && !isNaN(proc.pid))
	} catch (error) {
		return []
	}
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
	})

	useEffect(() => {
		const processes = getNodeProcesses()
		if (processes.length === 0) {
			setState((prev) => ({ ...prev, error: '未找到任何 Node.js 进程' }))
		} else {
			setState((prev) => ({ ...prev, processes }))
		}
	}, [])

	useInput((input, key) => {
		if (key.escape || (key.ctrl && input === 'c')) {
			exit()
			return
		}

		if (state.step === Steps.SelectPid) {
			if (key.upArrow) {
				setState((prev) => ({
					...prev,
					selectedPidIndex: prev.selectedPidIndex === 0 ? prev.processes.length - 1 : prev.selectedPidIndex - 1,
				}))
			} else if (key.downArrow) {
				setState((prev) => ({
					...prev,
					selectedPidIndex: prev.selectedPidIndex === prev.processes.length - 1 ? 0 : prev.selectedPidIndex + 1,
				}))
			} else if (key.return) {
				const selectedProcess = state.processes[state.selectedPidIndex]
				if (selectedProcess) {
					setState((prev) => ({
						...prev,
						selectedPid: selectedProcess.pid,
						step: Steps.SelectCommand,
					}))
				}
			}
		} else if (state.step === Steps.SelectCommand) {
			if (key.upArrow) {
				setState((prev) => ({
					...prev,
					selectedCommandIndex:
						prev.selectedCommandIndex === 0 ? COMMAND_CONFIGS.length - 1 : prev.selectedCommandIndex - 1,
				}))
			} else if (key.downArrow) {
				setState((prev) => ({
					...prev,
					selectedCommandIndex:
						prev.selectedCommandIndex === COMMAND_CONFIGS.length - 1 ? 0 : prev.selectedCommandIndex + 1,
				}))
			} else if (key.return) {
				const selectedConfig = COMMAND_CONFIGS[state.selectedCommandIndex]
				if (selectedConfig) {
					setState((prev) => ({
						...prev,
						selectedCommand: selectedConfig.command,
						step: Steps.Running,
					}))

					// 执行选中的命令
					executeCommand(state.selectedPid!, selectedConfig.command)
				}
			} else if (key.backspace) {
				setState((prev) => ({
					...prev,
					step: Steps.SelectPid,
					selectedCommandIndex: 0,
				}))
			}
		}
	})

	const executeCommand = async (pid: number, commandType: COMMAND_TYPE) => {
		try {
			// 构建命令选项
			let commandOptions: AllCommandOptions

			switch (commandType) {
				case COMMAND_TYPE.CPU_PROFILE:
					commandOptions = {
						commandType: COMMAND_TYPE.CPU_PROFILE,
						options: { duration: 10000 },
					}
					break
				case COMMAND_TYPE.HEAP_SNAPSHOT:
					commandOptions = {
						commandType: COMMAND_TYPE.HEAP_SNAPSHOT,
						options: { dir: '.' },
					}
					break
				case COMMAND_TYPE.REPORT:
					commandOptions = {
						commandType: COMMAND_TYPE.REPORT,
						options: { dir: '.' },
					}
					break
				case COMMAND_TYPE.MEMORY:
					commandOptions = {
						commandType: COMMAND_TYPE.MEMORY,
						options: {},
					}
					break
				case COMMAND_TYPE.START_INSPECT:
					commandOptions = {
						commandType: COMMAND_TYPE.START_INSPECT,
						options: {},
					}
					break
				case COMMAND_TYPE.STOP_INSPECT:
					commandOptions = {
						commandType: COMMAND_TYPE.STOP_INSPECT,
						options: {},
					}
					break
				case COMMAND_TYPE.RUN_CODE:
					commandOptions = {
						commandType: COMMAND_TYPE.RUN_CODE,
						options: { code: 'console.log("Hello from injected code!")' },
					}
					break
				case COMMAND_TYPE.MONITOR_CPU:
					commandOptions = {
						commandType: COMMAND_TYPE.MONITOR_CPU,
						options: {},
					}
					break
				default:
					throw new Error(`不支持的命令类型: ${commandType}`)
			}

			const cli = new CLI({
				pid,
				port: 9229,
				cmd: commandOptions,
			})

			await cli.run()
		} catch (error) {
			setState((prev) => ({
				...prev,
				error: `执行命令失败: ${(error as Error).message}`,
				step: Steps.SelectCommand,
			}))
		}
	}

	if (state.error) {
		return (
			<Box flexDirection='column'>
				<Text color='red'>错误: {state.error}</Text>
				<Text color='gray'>按 ESC 或 Ctrl+C 退出</Text>
			</Box>
		)
	}

	if (state.step === Steps.SelectPid) {
		return (
			<Box flexDirection='column'>
				<Text color='cyan' bold>
					请选择要分析的 Node.js 进程:
				</Text>
				<Text color='gray'>使用 ↑↓ 键选择，回车确认，ESC 退出</Text>
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

	if (state.step === Steps.Running) {
		return (
			<Box flexDirection='column'>
				<Text color='yellow'>正在执行命令: {state.selectedCommand}</Text>
				<Text color='yellow'>目标进程 PID: {state.selectedPid}</Text>
				<Text color='gray'>请等待...</Text>
			</Box>
		)
	}

	return null
}

// 如果直接运行此文件，则启动交互式 CLI
if (import.meta.url === `file://${process.argv[1]}`) {
	render(<InteractiveCLI />)
}

export default InteractiveCLI

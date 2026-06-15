#!/usr/bin/env node
import { Box, type Key, render, Text, useApp, useInput } from 'ink'
import { useEffect, useState } from 'react'
import type { DiagnosticPlugin } from './core/plugin.js'
import { registry } from './core/registry.js'
import { registerBuiltinPlugins } from './plugins/index.js'
import { InspectorSession } from './services/inspector-session.js'
import { createOutputFormatter } from './services/output-formatter.js'
import { getNodeProcesses, type NodeProcess } from './shared/command.js'

const DEFAULT_PORT = 9229

registerBuiltinPlugins()

enum Steps {
	SelectPid = 'SelectPid',
	SelectCommand = 'SelectCommand',
	Running = 'Running',
}

interface AppState {
	step: Steps
	processes: NodeProcess[]
	selectedPidIndex: number
	selectedPid: number | null
	selectedCommandIndex: number
	selectedCommand: string | null
	error: string | null
	executionStatus: 'idle' | 'running' | 'success' | 'error'
}

function InteractiveCLI() {
	const { exit } = useApp()
	const plugins = registry.getAll()

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

	const fetchProcesses = () => {
		try {
			const processes = getNodeProcesses()
			if (processes.length === 0) {
				setState((prev) => ({ ...prev, error: '未找到任何 Node.js 进程' }))
			} else {
				setState((prev) => ({
					...prev,
					processes,
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: 初始化
	useEffect(() => {
		fetchProcesses()
	}, [])

	useInput((input, key) => {
		if (key.escape || (key.ctrl && input === 'c')) {
			exit()
			return
		}

		if (state.executionStatus === 'success' || state.executionStatus === 'error') {
			if (key.return) {
				setState((prev) => ({
					...prev,
					step: Steps.SelectCommand,
					executionStatus: 'idle',
					error: null,
				}))
			} else if (key.backspace) {
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

		if (state.step === Steps.SelectPid) {
			handlePidSelectionInput(key, input)
		} else if (state.step === Steps.SelectCommand) {
			handleCommandSelectionInput(key, input)
		}
	})

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
		} else if (input === 'r' || input === 'R') {
			fetchProcesses()
		}
	}

	const handleCommandSelectionInput = (key: Key, _input: string) => {
		if (key.upArrow) {
			setState((prev) => ({
				...prev,
				selectedCommandIndex: prev.selectedCommandIndex === 0 ? plugins.length - 1 : prev.selectedCommandIndex - 1,
				error: null,
			}))
		} else if (key.downArrow) {
			setState((prev) => ({
				...prev,
				selectedCommandIndex: prev.selectedCommandIndex === plugins.length - 1 ? 0 : prev.selectedCommandIndex + 1,
				error: null,
			}))
		} else if (key.return) {
			const selectedPlugin = plugins[state.selectedCommandIndex]
			if (selectedPlugin) {
				setState((prev) => ({
					...prev,
					selectedCommand: selectedPlugin.name,
					step: Steps.Running,
					executionStatus: 'running',
					error: null,
				}))
				executeCommand(state.selectedPid!, selectedPlugin)
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

	const executeCommand = async (pid: number, plugin: DiagnosticPlugin) => {
		const session = new InspectorSession()
		const output = createOutputFormatter(false)
		try {
			await session.open(pid, DEFAULT_PORT)
			await session.connect(DEFAULT_PORT)

			const result = await plugin.execute({ pid, port: DEFAULT_PORT, json: false, session, output }, {})

			if (result.success) {
				setState((prev) => ({ ...prev, executionStatus: 'success', error: null }))
			} else {
				setState((prev) => ({ ...prev, error: result.error || 'Unknown error', executionStatus: 'error' }))
			}
		} catch (error) {
			setState((prev) => ({
				...prev,
				error: `执行命令失败: ${(error as Error).message}`,
				executionStatus: 'error',
			}))
		} finally {
			session.closeInspector().catch(() => {})
			session.close()
		}
	}

	if (state.error && state.executionStatus !== 'error') {
		return (
			<Box flexDirection='column'>
				<Text color='red'>错误: {state.error}</Text>
				<Text color='gray'>按 ESC 或 Ctrl+C 退出，R 键刷新进程列表</Text>
			</Box>
		)
	}

	if (state.step === Steps.SelectPid) {
		return (
			<Box flexDirection='column'>
				<Text color='cyan' bold>
					请选择要分析的 Node.js 进程:
				</Text>
				<Text color='gray'>使用 ↑↓ 键选择，回车确认，R 键刷新，ESC 退出</Text>
				<Text> </Text>
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
				{state.processes.map((proc, index) => (
					<Box key={proc.pid}>
						<Text color={index === state.selectedPidIndex ? 'green' : 'white'}>
							{index === state.selectedPidIndex ? '► ' : '  '}
							{proc.pid.toString().padEnd(8)}
							{proc.ppid.toString().padEnd(8)}
							{proc.stime.padEnd(10)}
							{proc.time.padEnd(12)}
							{proc.command}
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
				{plugins.map((plugin, index) => (
					<Box key={plugin.name} flexDirection='column'>
						<Text color={index === state.selectedCommandIndex ? 'green' : 'white'}>
							{index === state.selectedCommandIndex ? '► ' : '  '}
							{plugin.name} - {plugin.description}
						</Text>
					</Box>
				))}
			</Box>
		)
	}

	if (state.step === Steps.Running) {
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

render(<InteractiveCLI />)

#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from 'ink'
import { registerBuiltinPlugins } from './plugins/index.js'
import { AgentClient } from './services/agent-client.js'
import { executeDiagnostic } from './services/diagnostic-runner.js'
import { getNodeProcesses } from './shared/command.js'
import { InteractiveApp } from './tui/app.js'
import { TuiController } from './tui/controller.js'
import { createTerminalOutput } from './tui/terminal.js'

export { InteractiveApp, TuiView } from './tui/app.js'
export { TuiController } from './tui/controller.js'

export interface InteractiveOptions {
	pid?: number
	port?: number
	agentPort?: number
	historyDir?: string
}

// 返回的 Promise 在 Ink 退出且控制器请求清理后结束；导入组件不会启动终端 UI。
export async function startInteractive(options: InteractiveOptions = {}): Promise<void> {
	if (options.pid !== undefined && (!Number.isSafeInteger(options.pid) || options.pid <= 0)) {
		process.stderr.write('--pid must be a positive integer.\n')
		process.exitCode = 2
		return
	}
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		process.stderr.write(
			'交互式界面需要 TTY 终端。请在终端运行 mito-node --interactive，或使用 mito-node <command> --pid <PID> --json 供自动化读取。\n'
		)
		process.exitCode = 2
		return
	}
	registerBuiltinPlugins()
	const controller = new TuiController({
		getProcesses: getNodeProcesses,
		getProcessInfo: async (pid, signal) => {
			const agent = new AgentClient(options.agentPort, { signal })
			return (await agent.isAvailable()) ? agent.getProcessInfo(pid) : null
		},
		// --pid 仅预选初始进程；P 切换后的采样和无需目标的 history 必须使用控制器传入的 PID。
		execute: (command, parameters, settings) => executeDiagnostic(command, parameters, { ...options, ...settings }),
	})
	const terminal = createTerminalOutput(process.stdout)
	try {
		// Ink debug 模式提供完整布局帧；由自己的行差异输出层更新终端，避免默认整屏擦除。
		const instance = render(
			<InteractiveApp
				controller={controller}
				initialPid={options.pid}
				noColor={process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb'}
			/>,
			{ stdout: terminal.stdout, debug: true, exitOnCtrlC: false, patchConsole: false }
		)
		await instance.waitUntilExit()
	} finally {
		try {
			await controller.shutdown()
		} finally {
			terminal.close()
		}
	}
}

// CLI 的 --interactive 分支显式调用入口，独立执行本文件仍可使用相同的启动过程。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	startInteractive().catch((error) => {
		process.stderr.write(`TUI 启动失败: ${error instanceof Error ? error.message : String(error)}\n`)
		process.exitCode = 1
	})
}

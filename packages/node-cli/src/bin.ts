#!/usr/bin/env node
import { Command, CommanderError } from 'commander'
import { registry } from './core/registry.js'
import { registerBuiltinPlugins } from './plugins/index.js'
import { executeDiagnostic } from './services/diagnostic-runner.js'
import { createOutputFormatter } from './services/output-formatter.js'

const program = new Command()
const jsonRequested = process.argv.includes('--json')
registerBuiltinPlugins()
program
	.name('mito-node')
	.description('Node.js diagnostics for people and AI agents')
	.option('-p, --pid <pid>', 'target Node.js process ID')
	.option('--port <port>', 'target configured Inspector port', '9229')
	.option('--agent-port <port>', 'local Agent port', process.env.MITO_AGENT_TCP_PORT || '16666')
	.option('--timeout <ms>', 'total diagnostic timeout in milliseconds', '30000')
	.option('--dir <dir>', 'directory for generated diagnostic artifacts')
	.option('--history-dir <dir>', 'directory for diagnostic history')
	.option('--no-history', 'do not persist this diagnostic result')
	.option('--json', 'emit one JSON result for automation', false)
	.option('-i, --interactive', 'open the diagnostic workbench', false)
	.exitOverride()
	.configureOutput({
		writeErr: (text) => {
			if (!jsonRequested) process.stderr.write(text)
		},
	})
	.action(async () => {
		const options = program.opts()
		if (!options.interactive) {
			if (options.json) throw new CommanderError(2, 'commander.missingArgument', 'A diagnostic command is required.')
			program.help()
			return
		}
		if (options.json)
			throw new CommanderError(2, 'commander.conflictingOption', '--interactive and --json cannot be combined.')
		// Ink is loaded only for human interaction; machine commands avoid its startup cost and console renderer.
		// @ts-expect-error The interactive entry is a sibling generated bundle.
		const { startInteractive } = await import('./interactive-cli.mjs')
		await startInteractive({
			pid: options.pid === undefined ? undefined : Number(options.pid),
			port: Number(options.port),
			agentPort: Number(options.agentPort),
			historyDir: options.historyDir,
		})
	})

for (const plugin of registry.getAll()) {
	const command = program.command(plugin.name).description(plugin.description)
	for (const option of plugin.options ?? []) command.option(option.flags, option.description, option.defaultValue)
	command.action(async (localOptions) => {
		const globalOptions = program.opts()
		const controller = new AbortController()
		const cancel = () => controller.abort()
		process.once('SIGINT', cancel)
		process.once('SIGTERM', cancel)
		try {
			const result = await executeDiagnostic(
				plugin.name,
				{ ...globalOptions, ...localOptions },
				{
					pid: Number(globalOptions.pid),
					port: Number(globalOptions.port),
					agentPort: Number(globalOptions.agentPort),
					timeout: Number(globalOptions.timeout),
					historyDir: globalOptions.historyDir,
					recordHistory: globalOptions.history,
					signal: controller.signal,
				}
			)
			createOutputFormatter(globalOptions.json)(result)
			process.exitCode = result.success
				? 0
				: result.errorCode === 'INVALID_ARGUMENT'
					? 2
					: result.errorCode === 'CANCELLED'
						? 130
						: 1
		} finally {
			process.off('SIGINT', cancel)
			process.off('SIGTERM', cancel)
		}
	})
}

try {
	await program.parseAsync(process.argv)
} catch (error) {
	const value = error as CommanderError
	if (value.code === 'commander.helpDisplayed' || value.code === 'commander.version') process.exitCode = 0
	else {
		createOutputFormatter(jsonRequested)({
			success: false,
			command: program.args[0] || 'mito-node',
			error: value.message,
			errorCode: 'INVALID_ARGUMENT',
		})
		process.exitCode = 2
	}
}

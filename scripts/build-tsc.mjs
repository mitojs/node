import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const directory = resolve(process.argv[2] || '.')
const project = join(directory, 'tsconfig.json')
try {
	const config = ts.readConfigFile(project, ts.sys.readFile)
	if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory, undefined, project)
	if (parsed.errors.length)
		throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
	const outDir = parsed.options.outDir
	const buildInfo = ts.getTsBuildInfoEmitOutputFilePath(parsed.options)
	if (!outDir) throw new Error('Fresh builds require an explicit outDir')
	const outputs = [outDir, buildInfo].filter(Boolean)
	for (const output of outputs) {
		const local = relative(directory, output)
		if (
			!local ||
			isAbsolute(local) ||
			local === '..' ||
			local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
		)
			throw new Error('Build outputs must stay inside the selected package')
	}
	// tsc 增量编译不删除已移除源码的旧产物；同时清理对应 build info，避免空目录被误判为已构建。
	// 仅清理当前包配置的输出，benchmark 的冻结副本及兄弟目录不会被触碰。
	await rm(outDir, { recursive: true, force: true })
	if (buildInfo) await rm(buildInfo, { force: true })
	const compiler = join(dirname(require.resolve('typescript/package.json')), 'lib', 'tsc.js')
	const result = spawnSync(process.execPath, [compiler, '-b', project], { stdio: 'inherit' })
	if (result.error) throw result.error
	process.exitCode = result.status ?? 1
} catch (error) {
	process.stderr.write(`${error.message}\n`)
	process.exitCode = 1
}

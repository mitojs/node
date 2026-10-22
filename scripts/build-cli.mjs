import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [target = 'esm', ...args] = process.argv.slice(2)
if (!['esm', 'cjs', 'bin', 'interactive'].includes(target)) {
	process.stderr.write('Build target must be esm, cjs, bin or interactive\n')
	process.exitCode = 2
} else {
	// 通过进程环境传递目标，保证 Windows cmd.exe 与 Unix 使用同一构建入口。
	const require = createRequire(new URL('../packages/node-cli/package.json', import.meta.url))
	const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
	const result = spawnSync(process.execPath, [vite, 'build', ...args], {
		cwd: fileURLToPath(new URL('../packages/node-cli/', import.meta.url)),
		env: { ...process.env, BUILD_TARGET: target },
		stdio: 'inherit',
	})
	if (result.error) {
		process.stderr.write(`${result.error.message}\n`)
		process.exitCode = 1
	} else process.exitCode = result.status ?? 1
}

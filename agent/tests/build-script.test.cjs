const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const script = path.resolve(__dirname, '../build.sh')

test('package build entry launches its shell helper without requiring execute permissions', () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mito-build-entry-'))
	try {
		const project = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'))
		fs.mkdirSync(path.join(directory, 'agent'))
		fs.writeFileSync(
			path.join(directory, 'package.json'),
			JSON.stringify({ private: true, scripts: { 'build:rust': project.scripts['build:rust'] } })
		)
		// Windows package scripts use cmd.exe; the Bash helper must have an explicit interpreter.
		// A non-executable fixture catches that requirement on Unix without compiling the Agent.
		fs.writeFileSync(path.join(directory, 'agent/build.sh'), 'printf "invoked" > entry-result.txt\n', { mode: 0o644 })
		const result = spawnSync('pnpm', ['run', 'build:rust'], {
			cwd: directory,
			encoding: 'utf8',
			shell: process.platform === 'win32',
		})
		assert.equal(result.status, 0, result.stderr || result.error?.message)
		assert.equal(fs.readFileSync(path.join(directory, 'agent/entry-result.txt'), 'utf8'), 'invoked')
	} finally {
		fs.rmSync(directory, { recursive: true, force: true })
	}
})

function shell(source, cwd = os.tmpdir()) {
	return spawnSync('bash', ['-c', `source '${script}'; ${source}`], { cwd, encoding: 'utf8' })
}
test('sourcing the build helper never runs a build', () => {
	const result = shell(':')
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout, '')
})
test('Windows MSVC target uses the SDK-consumable x64 filename', () => {
	const result = shell('get_binary_name x86_64-pc-windows-msvc')
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout.trim(), 'mitojs-agent-win-x64.exe')
})
test('Git Bash native Windows selects the rustup host target', () => {
	const result = shell(
		"uname(){ if [[ $1 == -s ]]; then echo MINGW64_NT-10.0; else echo x86_64; fi; }; rustc(){ echo 'host: x86_64-pc-windows-msvc'; }; determine_targets ''"
	)
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout.trim(), 'x86_64-pc-windows-msvc')
})

test('native Linux musl build selects the portable installed musl-gcc linker', () => {
	const source = `uname(){ if [[ $1 == -s ]]; then echo Linux; else echo x86_64; fi; }; command(){ if [[ $1 == -v && $2 == musl-gcc ]]; then echo /toolchains/musl-gcc; return 0; fi; builtin command "$@"; }; check_toolchain_dependencies x86_64-unknown-linux-musl; echo "$CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER"`
	const result = shell(source)
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout.trim(), '/toolchains/musl-gcc')
})

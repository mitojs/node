import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../build-tsc.mjs', import.meta.url))
const directories = []
afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'mito-fresh-build-'))
	directories.push(directory)
	await mkdir(join(directory, 'src'))
	await mkdir(join(directory, 'frozen-variant'))
	await writeFile(join(directory, 'frozen-variant', 'sdk.js'), 'preserved benchmark variant')
	await writeFile(
		join(directory, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				composite: true,
				incremental: true,
				target: 'ES2020',
				module: 'CommonJS',
				types: [],
				rootDir: 'src',
				outDir: 'dist',
				tsBuildInfoFile: 'cache/build.tsbuildinfo',
			},
			include: ['src/**/*.ts'],
		})
	)
	await writeFile(join(directory, 'src', 'keep.ts'), 'export const current = 1\n')
	await writeFile(join(directory, 'src', 'remove.ts'), 'export const obsolete = 2\n')
	return directory
}
function build(directory) {
	return spawnSync(process.execPath, [script, directory], { encoding: 'utf8' })
}

test('removing source removes all its stale emitted files on the next build', async () => {
	const directory = await fixture()
	let result = build(directory)
	assert.equal(result.status, 0, result.stderr + result.stdout)
	assert(existsSync(join(directory, 'dist', 'remove.js')))
	await rm(join(directory, 'src', 'remove.ts'))
	await writeFile(join(directory, 'dist', 'deleted-worker.js'), 'obsolete build artifact')
	result = build(directory)
	assert.equal(result.status, 0, result.stderr + result.stdout)
	assert.equal(existsSync(join(directory, 'dist', 'remove.js')), false)
	assert.equal(existsSync(join(directory, 'dist', 'remove.d.ts')), false)
	assert.equal(existsSync(join(directory, 'dist', 'deleted-worker.js')), false)
	assert.equal(await readFile(join(directory, 'frozen-variant', 'sdk.js'), 'utf8'), 'preserved benchmark variant')
})

test('repeated unchanged builds emit complete outputs despite incremental build information', async () => {
	const directory = await fixture()
	for (let iteration = 0; iteration < 2; iteration++) {
		const result = build(directory)
		assert.equal(result.status, 0, result.stderr + result.stdout)
		assert.match(await readFile(join(directory, 'dist', 'keep.js'), 'utf8'), /current = 1/)
		assert(existsSync(join(directory, 'cache', 'build.tsbuildinfo')))
	}
})

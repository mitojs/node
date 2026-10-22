import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../assemble-release-binaries.mjs', import.meta.url))
const roots = []
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const targets = [
	['aarch64-apple-darwin', 'mitojs-agent-darwin-arm64'],
	['x86_64-apple-darwin', 'mitojs-agent-darwin-x64'],
	['x86_64-unknown-linux-musl', 'mitojs-agent-linux-x64-musl'],
	['aarch64-unknown-linux-musl', 'mitojs-agent-linux-arm64-musl'],
	['x86_64-pc-windows-msvc', 'mitojs-agent-win-x64.exe'],
]
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'mito-release-test-'))
	roots.push(root)
	const source = join(root, 'source')
	const destination = join(root, 'destination')
	await mkdir(source)
	for (const [target, filename] of targets) {
		const data = Buffer.from(`controlled artifact for ${target}`)
		await writeFile(join(source, filename), data)
		await writeFile(
			join(source, `${target}.json`),
			JSON.stringify({
				target,
				filename,
				commit: 'test-commit',
				sha256: createHash('sha256').update(data).digest('hex'),
			})
		)
	}
	return { source, destination }
}
function assemble(source, destination) {
	return spawnSync(process.execPath, [script, '--from', source, '--to', destination, '--commit', 'test-commit'], {
		encoding: 'utf8',
	})
}

test('assembles all five verified target artifacts and their provenance manifest', async () => {
	const { source, destination } = await fixture()
	const result = assemble(source, destination)
	assert.equal(result.status, 0, result.stderr)
	assert.equal(
		await readFile(join(destination, 'mitojs-agent-win-x64.exe'), 'utf8'),
		'controlled artifact for x86_64-pc-windows-msvc'
	)
	const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'))
	assert.equal(manifest.commit, 'test-commit')
	assert.equal(manifest.binaries.length, 5)
})

test('rejects an artifact changed after collection before touching destination', async () => {
	const { source, destination } = await fixture()
	await mkdir(destination)
	await writeFile(join(destination, 'mitojs-agent-darwin-arm64'), 'previous verified artifact')
	await writeFile(join(source, 'mitojs-agent-linux-x64-musl'), 'tampered bytes')
	const result = assemble(source, destination)
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /checksum/i)
	assert.equal(await readFile(join(destination, 'mitojs-agent-darwin-arm64'), 'utf8'), 'previous verified artifact')
})

test('rejects a binary built from a different commit', async () => {
	const { source, destination } = await fixture()
	const path = join(source, 'aarch64-apple-darwin.json')
	const manifest = JSON.parse(await readFile(path, 'utf8'))
	await writeFile(path, JSON.stringify({ ...manifest, commit: 'stale-commit' }))
	const result = assemble(source, destination)
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /commit/i)
})

test('rejects a missing advertised target instead of reusing checked-in binaries', async () => {
	const { source, destination } = await fixture()
	await rm(join(source, 'x86_64-pc-windows-msvc.json'))
	const result = assemble(source, destination)
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /missing|ENOENT/i)
})

test('collects the compiled Windows executable bytes with the advertised SDK filename', async () => {
	const { source, destination } = await fixture()
	const collector = fileURLToPath(new URL('../collect-agent-binary.mjs', import.meta.url))
	const result = spawnSync(
		process.execPath,
		[
			collector,
			'--target',
			'x86_64-pc-windows-msvc',
			'--from',
			join(source, 'mitojs-agent-win-x64.exe'),
			'--to',
			destination,
			'--commit',
			'fresh-build',
		],
		{ encoding: 'utf8' }
	)
	assert.equal(result.status, 0, result.stderr)
	assert.equal(
		await readFile(join(destination, 'mitojs-agent-win-x64.exe'), 'utf8'),
		'controlled artifact for x86_64-pc-windows-msvc'
	)
	const manifest = JSON.parse(await readFile(join(destination, 'x86_64-pc-windows-msvc.json'), 'utf8'))
	assert.equal(manifest.commit, 'fresh-build')
	assert.equal(manifest.filename, 'mitojs-agent-win-x64.exe')
	assert.equal(
		manifest.sha256,
		createHash('sha256').update('controlled artifact for x86_64-pc-windows-msvc').digest('hex')
	)
})

test('rejects an invalid CLI build target without launching a compiler', () => {
	const build = fileURLToPath(new URL('../build-cli.mjs', import.meta.url))
	const result = spawnSync(process.execPath, [build, 'invalid'], { encoding: 'utf8' })
	assert.equal(result.status, 2)
	assert.match(result.stderr, /target must be/i)
})

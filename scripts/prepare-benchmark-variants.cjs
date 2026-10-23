#!/usr/bin/env node
// Freeze the optimized build and an explicitly reconstructed eager-stack/barrel-import control.
const { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, realpathSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const stage = path.resolve(process.argv[2] || path.join(root, '.tmp/benchmark-variants'))
if (existsSync(stage)) throw new Error(`Preserve existing evidence; choose a fresh staging directory: ${stage}`)
const report = path.join(root, 'docs/reports/implementation')
const binaryName = require(path.join(root, 'packages/node/dist/binary')).getPlatformInfo().binaryName
const frozenBinary = path.join(stage, binaryName)
mkdirSync(stage, { recursive: true })
cpSync(path.join(root, 'packages/node/binaries', binaryName), frozenBinary)
const frozenShared = path.join(stage, 'node-shared')
mkdirSync(frozenShared, { recursive: true })
cpSync(path.join(root, 'packages/shared/package.json'), path.join(frozenShared, 'package.json'))
cpSync(path.join(root, 'packages/shared/dist'), path.join(frozenShared, 'dist'), { recursive: true })
const affected = ['shared/ReactiveSubject.ts', 'collector/timeout.ts', 'shared/stack.ts']
const after = Object.fromEntries(
	affected.map((file) => [file, readFileSync(path.join(root, 'packages/node/src', file), 'utf8')])
)
const before = { ...after }
before['shared/ReactiveSubject.ts'] = before['shared/ReactiveSubject.ts'].replace(
	"import { Subject } from 'rxjs/internal/Subject'",
	"import { Subject } from 'rxjs'"
)
before['collector/timeout.ts'] = before['collector/timeout.ts']
	.replace('import { captureStackFilePath }', 'import { getStackFilePath }')
	.replace(/\s*const readStack = captureStackFilePath\(name(?:, 2)?\)/, '')
	.replace(/get stack\(\) \{\s*return readStack\(\)\s*\}/, 'stack: getStackFilePath(name)')
const originalStack = spawnSync('git', ['show', 'HEAD:packages/node/src/shared/stack.ts'], {
	cwd: root,
	encoding: 'utf8',
})
if (originalStack.status !== 0) throw new Error(originalStack.stderr)
before['shared/stack.ts'] = originalStack.stdout
if (
	before['shared/ReactiveSubject.ts'] === after['shared/ReactiveSubject.ts'] ||
	before['collector/timeout.ts'] === after['collector/timeout.ts']
)
	throw new Error('Control transformation failed; inspect current SDK source')
const manifest = {
	createdAt: new Date().toISOString(),
	description:
		'Both immutable variants copy the same current dist; three listed modules are transpiled from frozen TypeScript source. Before restores only the top-level RxJS import and eager timer stack formatting; all reliability fixes remain identical. Frozen source text and SHA256 retained.',
	binary: { path: frozenBinary, sha256: createHash('sha256').update(readFileSync(frozenBinary)).digest('hex') },
	variants: {},
}
for (const [name, sources] of [
	['before', before],
	['after', after],
]) {
	const destination = path.join(stage, name)
	if (existsSync(destination))
		throw new Error(`Variant already exists: ${destination}; use a fresh staging folder to preserve evidence`)
	mkdirSync(destination, { recursive: true })
	cpSync(path.join(root, 'packages/node/dist'), destination, { recursive: true })
	// pnpm keeps SDK dependencies package-local, so freeze their resolution context as an explicit symlink.
	const modules = path.join(destination, 'node_modules')
	mkdirSync(path.join(modules, '@mitojs'), { recursive: true })
	symlinkSync(frozenShared, path.join(modules, '@mitojs/node-shared'), 'dir')
	for (const dependency of ['rxjs', 'deepmerge'])
		symlinkSync(
			realpathSync(path.join(root, 'packages/node/node_modules', dependency)),
			path.join(modules, dependency),
			'dir'
		)
	const hashes = {}
	for (const [file, source] of Object.entries(sources)) {
		const output = ts.transpileModule(source, {
			compilerOptions: {
				target: ts.ScriptTarget.ES2020,
				module: ts.ModuleKind.CommonJS,
				esModuleInterop: true,
				removeComments: true,
			},
		}).outputText
		writeFileSync(path.join(destination, file.replace(/\.ts$/, '.js')), output)
		const snapshot = path.join(report, 'benchmark-variant-sources', name, file + '.txt')
		mkdirSync(path.dirname(snapshot), { recursive: true })
		writeFileSync(snapshot, source)
		hashes[file] = {
			sourceSha256: createHash('sha256').update(source).digest('hex'),
			compiledSha256: createHash('sha256').update(output).digest('hex'),
		}
	}
	manifest.variants[name] = { sdkPath: destination, modules: hashes }
}
mkdirSync(report, { recursive: true })
writeFileSync(path.join(report, 'benchmark-variants.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest, null, 2))

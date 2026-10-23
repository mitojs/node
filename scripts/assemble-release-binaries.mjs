import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { releasePlatforms } from './release-platforms.mjs'

const { values } = parseArgs({
	options: { from: { type: 'string' }, to: { type: 'string' }, commit: { type: 'string' } },
})
try {
	if (!values.from || !values.to || !values.commit)
		throw new Error('Required: --from <downloaded-artifacts> --to <binary-directory> --commit <expected-sha>')
	const source = resolve(values.from)
	const destination = resolve(values.to)
	const binaries = []
	// 先验证完整矩阵及来源，再替换任何文件；缺失目标绝不回退到仓库内旧二进制。
	for (const platform of releasePlatforms) {
		const manifest = JSON.parse(await readFile(join(source, `${platform.target}.json`), 'utf8'))
		if (manifest.target !== platform.target || manifest.filename !== platform.filename)
			throw new Error(`Target metadata mismatch: ${platform.target}`)
		if (manifest.commit !== values.commit) throw new Error(`Build commit mismatch: ${platform.target}`)
		const content = await readFile(join(source, platform.filename))
		if (createHash('sha256').update(content).digest('hex') !== manifest.sha256)
			throw new Error(`Artifact checksum mismatch: ${platform.target}`)
		binaries.push(manifest)
	}
	await mkdir(destination, { recursive: true })
	for (const binary of binaries) {
		const temporary = join(destination, `.${binary.filename}.tmp`)
		await copyFile(join(source, binary.filename), temporary)
		await chmod(temporary, 0o755)
		await rename(temporary, join(destination, binary.filename))
	}
	await writeFile(
		join(destination, '.manifest.json.tmp'),
		`${JSON.stringify({ version: 1, commit: values.commit, binaries }, null, 2)}\n`
	)
	await rename(join(destination, '.manifest.json.tmp'), join(destination, 'manifest.json'))
	process.stdout.write(`Verified ${binaries.length} fresh release binaries from ${values.commit}\n`)
} catch (error) {
	process.stderr.write(`${error.message}\n`)
	process.exitCode = 1
}

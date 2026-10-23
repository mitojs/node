import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { releasePlatforms } from './release-platforms.mjs'

const { values } = parseArgs({
	options: { target: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, commit: { type: 'string' } },
})
try {
	const platform = releasePlatforms.find((entry) => entry.target === values.target)
	if (!platform || !values.from || !values.to || !values.commit)
		throw new Error(
			'Required supported --target, --from <compiled-executable>, --to <artifact-directory>, --commit <sha>'
		)
	const source = resolve(values.from)
	const destination = resolve(values.to)
	const content = await readFile(source)
	if (!content.length) throw new Error('Compiled Agent binary is empty')
	await mkdir(destination, { recursive: true })
	await copyFile(source, join(destination, platform.filename))
	await chmod(join(destination, platform.filename), 0o755)
	await writeFile(
		join(destination, `${platform.target}.json`),
		`${JSON.stringify({ ...platform, commit: values.commit, sha256: createHash('sha256').update(content).digest('hex') }, null, 2)}\n`
	)
	process.stdout.write(`Collected ${platform.filename} from ${values.commit}\n`)
} catch (error) {
	process.stderr.write(`${error.message}\n`)
	process.exitCode = 1
}

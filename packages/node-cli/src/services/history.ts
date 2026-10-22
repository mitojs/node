import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export interface HistoryInput {
	pid?: number
	command: string
	success: boolean
	result: unknown
	dataSource?: string
	artifacts?: string[]
}
export interface HistoryRecord extends HistoryInput {
	version: 1
	id: string
	timestamp: string
	artifacts: string[]
}
export interface MetricDelta {
	metric: string
	before: number
	after: number
	delta: number
	percentChange?: number
}
export interface HistoryComparison {
	first: HistoryRecord
	second: HistoryRecord
	deltas: MetricDelta[]
	artifactChanges: { added: string[]; removed: string[] }
}
export interface ArtifactRecord {
	path: string
	recordId: string
	timestamp: string
	command: string
	pid?: number
}
export interface HistoryOptions {
	directory?: string
	maxRecords?: number
	maxBytes?: number
}
const recordName = /^\d+-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/i
const metricNames = new Set([
	'cpuPercent',
	'heapUsed',
	'heapTotal',
	'rss',
	'active',
	'timerCount',
	'totalTimers',
	'used_heap_size',
	'total_heap_size',
	'external',
	'arrayBuffers',
])
let lastTimestamp = 0

// 显式目录用于测试和独立工作流；默认写入用户数据目录，避免污染被诊断项目。
export function resolveHistoryDirectory(explicit?: string): string {
	if (explicit) return resolve(explicit)
	if (process.env.MITO_HISTORY_DIR) return resolve(process.env.MITO_HISTORY_DIR)
	if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'mito-node', 'history')
	if (process.platform === 'win32')
		return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'mito-node', 'history')
	return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'mito-node', 'history')
}

// 只接受诊断结果声明的产物字段；任意字符串不被解释成文件路径，也不会删除产物文件。
export function extractArtifactPaths(result: unknown): string[] {
	const found = new Set<string>()
	const seen = new Set<object>()
	function walk(value: unknown) {
		if (!value || typeof value !== 'object' || seen.has(value)) return
		seen.add(value)
		for (const [key, item] of Object.entries(value)) {
			if (key === 'filename' && typeof item === 'string' && isAbsolute(item)) found.add(item)
			else if (key === 'artifacts' && Array.isArray(item)) {
				for (const artifact of item) if (typeof artifact === 'string' && isAbsolute(artifact)) found.add(artifact)
			} else walk(item)
		}
	}
	walk(result)
	return [...found]
}

function metrics(value: unknown, prefix = '', found: Record<string, number> = {}): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return found
	for (const [name, item] of Object.entries(value)) {
		const path = prefix ? `${prefix}.${name}` : name
		if (name === 'timers' && Array.isArray(item)) {
			found[`${path}.active`] = item.filter((timer) => timer && typeof timer === 'object' && !timer.destroyed).length
		} else if (name === 'hotspots' && Array.isArray(item)) {
			// 排名会随采样变化；只比较同一调用位置，未进入前十的函数不能被当成零耗时。
			for (const hotspot of item) {
				if (
					!hotspot ||
					typeof hotspot !== 'object' ||
					typeof hotspot.functionName !== 'string' ||
					typeof hotspot.url !== 'string'
				)
					continue
				const frame = JSON.stringify([hotspot.functionName, hotspot.url, hotspot.line, hotspot.column])
				for (const key of ['selfTimeMs', 'percent']) {
					if (typeof hotspot[key] === 'number' && Number.isFinite(hotspot[key]))
						found[`${path}${frame}.${key}`] = hotspot[key]
				}
			}
		} else if (metricNames.has(name) && typeof item === 'number' && Number.isFinite(item)) found[path] = item
		else if (
			metricNames.has(name) &&
			item &&
			typeof item === 'object' &&
			'end' in item &&
			typeof item.end === 'number' &&
			Number.isFinite(item.end)
		)
			found[path] = item.end
		else if (name !== 'observations' && name !== 'unavailable') metrics(item, path, found)
	}
	return found
}

export class HistoryStore {
	readonly directory: string
	private readonly maxRecords: number
	private readonly maxBytes: number
	private readonly notices = new Set<string>()
	private pending: Promise<unknown> = Promise.resolve()

	constructor(options: HistoryOptions = {}) {
		this.directory = resolveHistoryDirectory(options.directory)
		this.maxRecords = options.maxRecords ?? 100
		this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024
		if (
			!Number.isSafeInteger(this.maxRecords) ||
			this.maxRecords < 1 ||
			!Number.isSafeInteger(this.maxBytes) ||
			this.maxBytes < 1
		)
			throw new Error('History limits must be positive integers')
	}

	get warnings(): string[] {
		return [...this.notices]
	}

	// 每条记录单独原子落盘，多个 CLI 进程同时写入时不会覆盖彼此的索引。
	append(input: HistoryInput): Promise<HistoryRecord> {
		const operation = this.pending.then(async () => {
			if (!input.command || typeof input.command !== 'string' || typeof input.success !== 'boolean')
				throw new Error('Invalid history record')
			lastTimestamp = Math.max(Date.now(), lastTimestamp + 1)
			const record: HistoryRecord = {
				...input,
				version: 1,
				id: `${lastTimestamp}-${randomUUID()}`,
				timestamp: new Date(lastTimestamp).toISOString(),
				dataSource:
					input.dataSource ??
					(input.result &&
					typeof input.result === 'object' &&
					'source' in input.result &&
					typeof input.result.source === 'string'
						? input.result.source
						: undefined),
				artifacts: [
					...new Set([
						...(input.artifacts ?? []).filter((item) => isAbsolute(item)),
						...extractArtifactPaths(input.result),
					]),
				],
			}
			const contents = JSON.stringify(record)
			if (Buffer.byteLength(contents) > this.maxBytes) throw new Error('History record exceeds storage byte limit')
			await mkdir(this.directory, { recursive: true, mode: 0o700 })
			const temporary = join(this.directory, `.${record.id}.tmp`)
			try {
				await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
				await rename(temporary, join(this.directory, `${record.id}.json`))
			} finally {
				await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
					if (error.code !== 'ENOENT') throw error
				})
			}
			const existing = await this.readRecords()
			let bytes = 0
			for (const [index, item] of existing.entries()) {
				bytes += item.bytes
				if (index >= this.maxRecords || bytes > this.maxBytes) {
					// 仅修剪成功解析、文件名与记录 ID 一致的自有记录；产物及其他文件始终保留。
					await unlink(join(this.directory, `${item.record.id}.json`)).catch((error: NodeJS.ErrnoException) => {
						if (error.code !== 'ENOENT') throw error
					})
				}
			}
			return record
		})
		this.pending = operation.catch(() => {})
		return operation
	}

	async list(): Promise<HistoryRecord[]> {
		return (await this.readRecords()).map((item) => item.record)
	}

	async get(id: string): Promise<HistoryRecord | undefined> {
		// 通过已校验记录查找，不能把用户输入拼接成任意文件路径。
		return (await this.list()).find((record) => record.id === id)
	}

	async compare(firstId: string, secondId: string): Promise<HistoryComparison> {
		const records = await this.list()
		const first = records.find((record) => record.id === firstId)
		const second = records.find((record) => record.id === secondId)
		if (!first || !second) throw new Error('History record not found')
		if (first.pid !== second.pid || first.command !== second.command)
			throw new Error('Compare records from the same process and command')
		if (!first.success || !second.success) throw new Error('Compare successful diagnostic records only')
		const before = metrics(first.result)
		const after = metrics(second.result)
		const deltas: MetricDelta[] = Object.keys(before)
			.filter((key) => key in after)
			.sort()
			.map((metric) => ({
				metric,
				before: before[metric],
				after: after[metric],
				delta: after[metric] - before[metric],
				...(before[metric] !== 0
					? { percentChange: ((after[metric] - before[metric]) / Math.abs(before[metric])) * 100 }
					: {}),
			}))
		return {
			first,
			second,
			deltas,
			artifactChanges: {
				added: second.artifacts.filter((path) => !first.artifacts.includes(path)),
				removed: first.artifacts.filter((path) => !second.artifacts.includes(path)),
			},
		}
	}

	async artifacts(): Promise<ArtifactRecord[]> {
		return (await this.list()).flatMap((record) =>
			record.artifacts.map((path) => ({
				path,
				recordId: record.id,
				timestamp: record.timestamp,
				command: record.command,
				pid: record.pid,
			}))
		)
	}

	private async readRecords(): Promise<Array<{ record: HistoryRecord; bytes: number }>> {
		let entries: Dirent[]
		try {
			entries = await readdir(this.directory, { withFileTypes: true })
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
			throw error
		}
		const result: Array<{ record: HistoryRecord; bytes: number }> = []
		for (const entry of entries) {
			if (!entry.isFile() || !recordName.test(entry.name)) continue
			try {
				const content = await readFile(join(this.directory, entry.name), 'utf8')
				const record = JSON.parse(content) as HistoryRecord
				if (
					record.version !== 1 ||
					`${record.id}.json` !== entry.name ||
					!Number.isFinite(Date.parse(record.timestamp)) ||
					typeof record.command !== 'string' ||
					!record.command ||
					typeof record.success !== 'boolean' ||
					!Array.isArray(record.artifacts) ||
					!record.artifacts.every((item) => typeof item === 'string' && isAbsolute(item))
				)
					throw new Error('Invalid record schema')
				result.push({ record, bytes: Buffer.byteLength(content) })
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && this.notices.size < 100)
					this.notices.add(`Skipped unreadable history record ${entry.name}: ${(error as Error).message}`)
			}
		}
		return result.sort(
			(a, b) => b.record.timestamp.localeCompare(a.record.timestamp) || b.record.id.localeCompare(a.record.id)
		)
	}
}

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DiagnosticContext } from '../../core/types.js'
import { historyPlugin } from '../../plugins/history.js'
import { HistoryStore } from '../../services/history.js'

const directories: string[] = []
const ctx: DiagnosticContext = { pid: 0, port: 9229, json: true, output: () => {} }
afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function fixture() {
	const historyDir = await mkdtemp(join(tmpdir(), 'mito-history-plugin-'))
	directories.push(historyDir)
	const store = new HistoryStore({ directory: historyDir })
	const first = await store.append({
		pid: 123,
		command: 'monitor-cpu',
		success: true,
		result: { cpuPercent: 0, filename: '/tmp/cpu.cpuprofile' },
	})
	const second = await store.append({ pid: 123, command: 'monitor-cpu', success: true, result: { cpuPercent: 10 } })
	return { historyDir, first, second }
}
describe('history command', () => {
	it('lists and opens stored results without a target process', async () => {
		const { historyDir, first } = await fixture()
		const list = await historyPlugin.execute(ctx, { historyDir })
		expect(list.success).toBe(true)
		expect(list.data.records).toHaveLength(2)
		expect((await historyPlugin.execute(ctx, { historyDir, id: first.id })).data.record.result.cpuPercent).toBe(0)
	})
	it('returns meaningful comparison metrics and declared artifact paths', async () => {
		const { historyDir, first, second } = await fixture()
		const comparison = await historyPlugin.execute(ctx, { historyDir, compare: `${first.id},${second.id}` })
		expect(comparison.data.comparison.deltas).toEqual([{ metric: 'cpuPercent', before: 0, after: 10, delta: 10 }])
		expect((await historyPlugin.execute(ctx, { historyDir, artifacts: true })).data.artifacts[0].path).toBe(
			'/tmp/cpu.cpuprofile'
		)
	})
	it('returns explicit failures for missing IDs and invalid option combinations', async () => {
		const { historyDir, first } = await fixture()
		expect(await historyPlugin.execute(ctx, { historyDir, id: 'missing' })).toMatchObject({
			success: false,
			errorCode: 'HISTORY_NOT_FOUND',
		})
		expect(await historyPlugin.execute(ctx, { historyDir, compare: 'one' })).toMatchObject({
			success: false,
			errorCode: 'INVALID_ARGUMENT',
		})
		expect(await historyPlugin.execute(ctx, { historyDir, id: first.id, artifacts: true })).toMatchObject({
			success: false,
			errorCode: 'INVALID_ARGUMENT',
		})
	})
})

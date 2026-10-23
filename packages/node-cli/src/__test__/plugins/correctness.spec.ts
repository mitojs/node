import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticContext } from '../../core/types'
import { FUNCTION_WRAPPER } from '../../helper'
import { heapSnapshotPlugin } from '../../plugins/heap-snapshot'
import { monitorCpuPlugin } from '../../plugins/monitor-cpu'
import { monitorMemoryPlugin } from '../../plugins/monitor-memory'
import { reportPlugin } from '../../plugins/report'

const directories: string[] = []
afterEach(async () => {
	vi.useRealTimers()
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function context(overrides: Record<string, unknown> = {}): DiagnosticContext {
	return { pid: process.pid, port: 9229, json: true, output: () => {}, ...overrides } as DiagnosticContext
}

describe('diagnostic value correctness', () => {
	it('measures CPU from sample deltas and preserves multi-core usage above 100 percent', async () => {
		vi.useFakeTimers()
		const evaluate = vi
			.fn()
			.mockResolvedValueOnce({ cpuUsage: { user: 100000, system: 50000 }, hrtime: '1000000000' })
			.mockResolvedValueOnce({ cpuUsage: { user: 1600000, system: 550000 }, hrtime: '2000000000' })
		const pending = monitorCpuPlugin.execute(context({ session: { evaluate } }), {})
		await vi.advanceTimersByTimeAsync(1000)
		const result = await pending
		expect(result.data.cpuPercent).toBe(200)
		expect(Number.isFinite(result.data.cpuPercent)).toBe(true)
	})

	it('reads the SDK memory payload instead of reporting a fabricated zero', async () => {
		const result = await monitorMemoryPlugin.execute(
			context({
				agentClient: {
					getProcessInfo: async () => ({
						registeredSubjects: ['Memory'],
						updatedAt: { Memory: Date.now() },
						intervals: { Memory: 5000 },
						metrics: {
							memory: {
								heapInfo: {},
								heapSpaces: [],
								memory: {
									heapUsed: 12000000,
									heapTotal: 20000000,
									rss: 48000000,
								},
							},
						},
					}),
				},
			}),
			{}
		)
		expect(result.data).toMatchObject({ heapUsed: 12000000, heapTotal: 20000000, rss: 48000000, source: 'agent' })
	})

	it.each([
		['CPU', monitorCpuPlugin, { cpu: { load: 42 } }],
		['Memory', monitorMemoryPlugin, { memory: { memory: { heapUsed: 12, heapTotal: 20, rss: 48 } } }],
	] as const)(
		'preserves the actual %s sampling time and interval for freshness and chart deduplication',
		async (subject, plugin, metrics) => {
			const sampledAt = Date.now() - 100
			const result = await plugin.execute(
				context({
					agentClient: {
						getProcessInfo: async () => ({
							registeredSubjects: [subject],
							updatedAt: { [subject]: sampledAt },
							intervals: { [subject]: 250 },
							metrics,
						}),
					},
				}),
				{}
			)
			expect(result.data).toMatchObject({ sampledAt, interval: 250, source: 'agent' })
		}
	)

	it.each(['0', 'false', "''", 'null'])('preserves a valid evaluated value %s', async (literal) => {
		const envelope = JSON.parse(await runInNewContext(FUNCTION_WRAPPER(`return ${literal}`)))
		expect(Object.hasOwn(envelope, 'data')).toBe(true)
		expect(envelope.data).toEqual(JSON.parse(literal === "''" ? '""' : literal))
	})

	it.each([reportPlugin, heapSnapshotPlugin])(
		'saves $name beneath the requested directory including quoted paths',
		async (plugin) => {
			const directory = await mkdtemp(path.join(tmpdir(), "mito-report-'"))
			directories.push(directory)
			const result = await plugin.execute(context({ session: { evaluate: async () => undefined } }), {
				dir: directory,
			})
			expect(path.dirname(result.data.filename)).toBe(directory)
			expect(result.data.source).toBe('inspector')
		}
	)
})

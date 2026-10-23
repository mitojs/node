import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticContext } from '../../core/types'
import { cpuProfilePlugin } from '../../plugins/cpu-profile'

const directories: string[] = []
afterEach(async () => {
	vi.useRealTimers()
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('CPU profiling lifecycle', () => {
	it('waits for enable before starting and writes a complete profile in the requested directory', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'mito-profile-'))
		directories.push(directory)
		vi.useFakeTimers()
		let release: () => void = () => {}
		const order: string[] = []
		const profile = { nodes: [{ id: 1 }], startTime: 0, endTime: 1000 }
		const session = {
			sendMessage: async (method: string) => {
				order.push(method)
				if (method === 'Profiler.enable')
					await new Promise<void>((resolve) => {
						release = resolve
					})
				return method === 'Profiler.stop' ? { profile } : {}
			},
		}
		const pending = cpuProfilePlugin.execute({ session } as unknown as DiagnosticContext, {
			duration: '100',
			dir: directory,
		})
		await Promise.resolve()
		expect(order).toEqual(['Profiler.enable'])
		release()
		await vi.advanceTimersByTimeAsync(100)
		const result = await pending
		expect(result.success).toBe(true)
		expect(path.dirname(result.data.filename)).toBe(directory)
		expect(JSON.parse(await readFile(result.data.filename, 'utf8'))).toEqual(profile)
		expect(order).toEqual(['Profiler.enable', 'Profiler.start', 'Profiler.stop', 'Profiler.disable'])
	})
	it('stops and disables an active profiler when waiting is cancelled', async () => {
		vi.useFakeTimers()
		const controller = new AbortController()
		const order: string[] = []
		const session = {
			sendMessage: async (method: string) => {
				order.push(method)
				return { profile: {} }
			},
		}
		const pending = cpuProfilePlugin.execute({ session, signal: controller.signal } as unknown as DiagnosticContext, {
			duration: '1000',
		})
		await vi.advanceTimersByTimeAsync(0)
		controller.abort()
		const result = await pending
		expect(result).toMatchObject({ success: false, errorCode: 'CANCELLED' })
		expect(order).toEqual(['Profiler.enable', 'Profiler.start', 'Profiler.stop', 'Profiler.disable'])
	})
})

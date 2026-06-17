import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticContext } from '../../core/types'
import { cpuProfilePlugin } from '../../plugins/cpu-profile'
import type { InspectorSession } from '../../services/inspector-session'

vi.mock('node:fs', () => ({
	writeFileSync: vi.fn(),
}))

vi.mock('../../helper', () => ({
	genFilename: vi.fn().mockReturnValue('/tmp/test-uuid.cpuprofile'),
	FUNCTION_WRAPPER: vi.fn((code: string) => code),
}))

function createMockSession(profileData: any): InspectorSession {
	return {
		evaluate: vi.fn(),
		sendMessage: vi.fn().mockImplementation((method: string) => {
			if (method === 'Profiler.stop') {
				return Promise.resolve({ profile: profileData })
			}
			return Promise.resolve({})
		}),
		open: vi.fn(),
		connect: vi.fn(),
		close: vi.fn(),
		closeInspector: vi.fn(),
	} as any
}

function createContext(overrides: Partial<DiagnosticContext> = {}): DiagnosticContext {
	return {
		pid: 12345,
		port: 9229,
		json: false,
		session: createMockSession({ nodes: [], startTime: 0, endTime: 1000 }),
		output: vi.fn(),
		...overrides,
	}
}

describe('cpuProfilePlugin', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('should have correct metadata', () => {
		expect(cpuProfilePlugin.name).toBe('cpuprofile')
		expect(cpuProfilePlugin.description).toBeDefined()
		expect(cpuProfilePlugin.options).toBeDefined()
		expect(cpuProfilePlugin.options).toHaveLength(1)
		expect(cpuProfilePlugin.options![0].flags).toContain('--duration')
		expect(cpuProfilePlugin.options![0].defaultValue).toBe('10000')
	})

	it('should call Profiler.enable and Profiler.start immediately', () => {
		const ctx = createContext()
		cpuProfilePlugin.execute(ctx, { duration: '5000' })

		expect(ctx.session.sendMessage).toHaveBeenCalledWith('Profiler.enable')
		expect(ctx.session.sendMessage).toHaveBeenCalledWith('Profiler.start')
	})

	it('should call Profiler.stop after the specified duration', async () => {
		const ctx = createContext()
		const resultPromise = cpuProfilePlugin.execute(ctx, { duration: '5000' })

		// Profiler.stop 还不应被调用
		expect(ctx.session.sendMessage).not.toHaveBeenCalledWith('Profiler.stop')

		vi.advanceTimersByTime(5000)
		const result = await resultPromise

		expect(ctx.session.sendMessage).toHaveBeenCalledWith('Profiler.stop')
		expect(result.success).toBe(true)
		expect(result.data.filename).toBe('/tmp/test-uuid.cpuprofile')
	})

	it('should use default duration of 10000ms when not specified', async () => {
		const ctx = createContext()
		const resultPromise = cpuProfilePlugin.execute(ctx, {})

		// 5 秒后不该结束
		vi.advanceTimersByTime(5000)
		expect(ctx.session.sendMessage).not.toHaveBeenCalledWith('Profiler.stop')

		// 再推进 5 秒（总计 10 秒）才结束
		vi.advanceTimersByTime(5000)
		const result = await resultPromise

		expect(ctx.session.sendMessage).toHaveBeenCalledWith('Profiler.stop')
		expect(result.success).toBe(true)
	})

	it('should write profile data to file via fs.writeFileSync', async () => {
		const fs = await import('node:fs')
		const profileData = { nodes: [{ id: 1 }], startTime: 0, endTime: 5000 }
		const session = createMockSession(profileData)
		const ctx = createContext({ session })

		const resultPromise = cpuProfilePlugin.execute(ctx, { duration: '1000' })
		vi.advanceTimersByTime(1000)
		await resultPromise

		expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/test-uuid.cpuprofile', JSON.stringify(profileData))
	})

	it('should call Profiler.disable after stop completes', async () => {
		const ctx = createContext()
		const resultPromise = cpuProfilePlugin.execute(ctx, { duration: '1000' })

		vi.advanceTimersByTime(1000)
		await resultPromise

		expect(ctx.session.sendMessage).toHaveBeenCalledWith('Profiler.disable')
	})

	it('should return error when Profiler.stop rejects', async () => {
		const session = {
			evaluate: vi.fn(),
			sendMessage: vi.fn().mockImplementation((method: string) => {
				if (method === 'Profiler.stop') {
					return Promise.reject(new Error('Profiler not started'))
				}
				return Promise.resolve({})
			}),
			open: vi.fn(),
			connect: vi.fn(),
			close: vi.fn(),
			closeInspector: vi.fn(),
		} as any

		const ctx = createContext({ session })
		const resultPromise = cpuProfilePlugin.execute(ctx, { duration: '1000' })

		vi.advanceTimersByTime(1000)
		const result = await resultPromise

		expect(result.success).toBe(false)
		expect(result.error).toBe('Profiler not started')
	})
})

import { describe, expect, it, vi } from 'vitest'
import type { DiagnosticContext } from '../../core/types'
import { reportPlugin } from '../../plugins/report'
import type { InspectorSession } from '../../services/inspector-session'

vi.mock('../../helper', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../helper')>()
	return {
		...actual,
		genFilename: vi.fn().mockReturnValue('/tmp/test-uuid.json'),
		FUNCTION_WRAPPER: vi.fn((code: string) => `wrapped(${code})`),
	}
})

function createMockSession(evaluateResult: any): InspectorSession {
	return {
		evaluate: vi.fn().mockResolvedValue(evaluateResult),
		sendMessage: vi.fn(),
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
		session: createMockSession(undefined),
		output: vi.fn(),
		...overrides,
	}
}

describe('reportPlugin', () => {
	it('should have correct metadata', () => {
		expect(reportPlugin.name).toBe('report')
		expect(reportPlugin.description).toBeDefined()
		expect(reportPlugin.options).toBeDefined()
		expect(reportPlugin.options).toHaveLength(1)
		expect(reportPlugin.options![0].flags).toContain('--dir')
	})

	it('should call session.evaluate with process.report.writeReport', async () => {
		const session = createMockSession(undefined)
		const ctx = createContext({ session })

		await reportPlugin.execute(ctx, {})

		expect(session.evaluate).toHaveBeenCalledTimes(1)
		const evaluateArg = vi.mocked(session.evaluate).mock.calls[0][0]
		expect(evaluateArg).toContain('process.report.writeReport')
	})

	it('should pass generated filename to writeReport', async () => {
		const session = createMockSession(undefined)
		const ctx = createContext({ session })

		await reportPlugin.execute(ctx, {})

		const evaluateArg = vi.mocked(session.evaluate).mock.calls[0][0]
		expect(evaluateArg).toContain('/tmp/test-uuid.json')
	})

	it('should return success with filename on successful execution', async () => {
		const session = createMockSession(undefined)
		const ctx = createContext({ session })

		const result = await reportPlugin.execute(ctx, {})

		expect(result.success).toBe(true)
		expect(result.data).toEqual({ filename: '/tmp/test-uuid.json' })
	})

	it('should propagate error when session.evaluate rejects', async () => {
		const session = {
			evaluate: vi.fn().mockRejectedValue(new Error('Evaluate failed')),
			sendMessage: vi.fn(),
			open: vi.fn(),
			connect: vi.fn(),
			close: vi.fn(),
			closeInspector: vi.fn(),
		} as any
		const ctx = createContext({ session })

		await expect(reportPlugin.execute(ctx, {})).rejects.toThrow('Evaluate failed')
	})

	it('should include error handling for unsupported Node.js versions in evaluated code', async () => {
		const session = createMockSession(undefined)
		const ctx = createContext({ session })

		await reportPlugin.execute(ctx, {})

		const { FUNCTION_WRAPPER } = await import('../../helper')
		const wrappedCode = vi.mocked(FUNCTION_WRAPPER).mock.calls[0][0]
		expect(wrappedCode).toContain('process.report')
		expect(wrappedCode).toContain('writeReport')
		expect(wrappedCode).toContain('throw new Error')
	})
})

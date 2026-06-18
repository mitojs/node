import { describe, expect, it, vi } from 'vitest'
import type { DiagnosticContext } from '../../core/types'
import { timersPlugin } from '../../plugins/timers'
import type { AgentClient, MetricsData } from '../../services/agent-client'
import type { InspectorSession } from '../../services/inspector-session'

vi.mock('../../helper', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../helper')>()
	return {
		...actual,
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

function createMockAgentClient(metrics: MetricsData | null): AgentClient {
	return {
		isAvailable: vi.fn().mockResolvedValue(true),
		getMetrics: vi.fn().mockResolvedValue(metrics),
	} as any
}

function createContext(overrides: Partial<DiagnosticContext> = {}): DiagnosticContext {
	return {
		pid: 12345,
		port: 9229,
		json: false,
		session: createMockSession(null),
		output: vi.fn(),
		...overrides,
	}
}

describe('timersPlugin', () => {
	it('should have correct metadata', () => {
		expect(timersPlugin.name).toBe('timers')
		expect(timersPlugin.description).toBeDefined()
		expect(timersPlugin.description).toContain('timer')
	})

	describe('Agent mode', () => {
		it('should return timers from agentClient when available', async () => {
			const mockTimers = [
				{ type: 'setTimeout', delay: 1000, stack: 'at foo.js:1' },
				{ type: 'setInterval', delay: 5000, stack: 'at bar.js:10' },
			]
			const agentClient = createMockAgentClient({ timers: mockTimers } as unknown as MetricsData)
			const session = createMockSession(null)
			const ctx = createContext({ agentClient, session })

			const result = await timersPlugin.execute(ctx, {})

			expect(result.success).toBe(true)
			expect(result.data.timers).toEqual(mockTimers)
			expect(result.data.source).toBe('agent')
			expect(agentClient.getMetrics).toHaveBeenCalledWith(12345)
			expect(session.evaluate).not.toHaveBeenCalled()
		})

		it('should fallback to Inspector when agentClient has no timers data', async () => {
			const agentClient = createMockAgentClient({ cpu: { load: 10, useLoad: 5 } } as MetricsData)
			const inspectorData = { sdkActive: true, message: 'Timer data is available via Agent channel.' }
			const session = createMockSession(inspectorData)
			const ctx = createContext({ agentClient, session })

			const result = await timersPlugin.execute(ctx, {})

			expect(result.success).toBe(true)
			expect(result.data.source).toBe('inspector')
			expect(session.evaluate).toHaveBeenCalled()
		})

		it('should fallback to Inspector when agentClient timers is empty array', async () => {
			const agentClient = createMockAgentClient({ timers: [] } as unknown as MetricsData)
			const inspectorData = { sdkActive: true, message: 'Timer data is available via Agent channel.' }
			const session = createMockSession(inspectorData)
			const ctx = createContext({ agentClient, session })

			const result = await timersPlugin.execute(ctx, {})

			expect(result.success).toBe(true)
			expect(result.data.source).toBe('inspector')
			expect(session.evaluate).toHaveBeenCalled()
		})

		it('should fallback to Inspector when agentClient.getMetrics returns null', async () => {
			const agentClient = createMockAgentClient(null)
			const inspectorData = { sdkActive: false, message: 'Timer detection requires @mitojs/node SDK' }
			const session = createMockSession(inspectorData)
			const ctx = createContext({ agentClient, session })

			const result = await timersPlugin.execute(ctx, {})

			expect(result.success).toBe(false)
			expect(result.error).toContain('Timer detection requires @mitojs/node SDK')
		})
	})

	describe('Inspector fallback', () => {
		it('should return error when SDK is not loaded', async () => {
			const inspectorData = {
				sdkActive: false,
				message: 'Timer detection requires @mitojs/node SDK to be loaded in the target process.',
			}
			const session = createMockSession(inspectorData)
			const ctx = createContext({ session })

			const result = await timersPlugin.execute(ctx, {})

			expect(result.success).toBe(false)
			expect(result.error).toBe('Timer detection requires @mitojs/node SDK to be loaded in the target process.')
		})

		it('should return success with inspector source when SDK is active', async () => {
			const inspectorData = {
				sdkActive: true,
				message: 'Timer data is available via Agent channel. Ensure Rust Agent is running.',
			}
			const session = createMockSession(inspectorData)
			const ctx = createContext({ session })

			const result = await timersPlugin.execute(ctx, {})

			expect(result.success).toBe(true)
			expect(result.data.source).toBe('inspector')
			expect(result.data.sdkActive).toBe(true)
		})

		it('should not call agentClient when it is not provided', async () => {
			const inspectorData = { sdkActive: false, message: 'SDK not loaded' }
			const session = createMockSession(inspectorData)
			const ctx = createContext({ session })

			const result = await timersPlugin.execute(ctx, {})

			expect(result.success).toBe(false)
			expect(session.evaluate).toHaveBeenCalled()
		})
	})
})

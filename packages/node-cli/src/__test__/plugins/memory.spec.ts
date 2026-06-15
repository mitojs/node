import { describe, expect, it, vi } from 'vitest'
import type { DiagnosticContext } from '../../core/types'
import { memoryPlugin } from '../../plugins/memory'
import type { AgentClient, MetricsData } from '../../services/agent-client'
import type { InspectorSession } from '../../services/inspector-session'

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
		session: createMockSession({ rss: 50000000, heapTotal: 20000000 }),
		output: vi.fn(),
		...overrides,
	}
}

describe('memoryPlugin', () => {
	it('should have correct metadata', () => {
		expect(memoryPlugin.name).toBe('memory')
		expect(memoryPlugin.description).toBeDefined()
	})

	describe('dual-mode execution', () => {
		it('should use Agent channel when agentClient is available and has memory data', async () => {
			const mockMemory = {
				heapInfo: {},
				heapSpaces: [],
				memory: { rss: 90000000, heapTotal: 24000000, heapUsed: 7000000 },
			}
			const agentClient = createMockAgentClient({ memory: mockMemory } as unknown as MetricsData)
			const session = createMockSession({})
			const ctx = createContext({ agentClient, session })

			const result = await memoryPlugin.execute(ctx, {})

			expect(result.success).toBe(true)
			expect(result.data.source).toBe('agent')
			expect(result.data.memory).toBeDefined()
			expect(session.evaluate).not.toHaveBeenCalled()
			expect(agentClient.getMetrics).toHaveBeenCalledWith(12345)
		})

		it('should fallback to Inspector when agentClient returns no memory data', async () => {
			const agentClient = createMockAgentClient({ cpu: { load: 10, useLoad: 5 } } as MetricsData)
			const inspectorData = { rss: 41000000, heapTotal: 5000000, heapUsed: 3500000 }
			const session = createMockSession(inspectorData)
			const ctx = createContext({ agentClient, session })

			const result = await memoryPlugin.execute(ctx, {})

			expect(result.success).toBe(true)
			expect(result.data.source).toBe('inspector')
			expect(session.evaluate).toHaveBeenCalled()
		})

		it('should fallback to Inspector when agentClient is not provided', async () => {
			const inspectorData = { rss: 41000000, heapTotal: 5000000 }
			const session = createMockSession(inspectorData)
			const ctx = createContext({ session })

			const result = await memoryPlugin.execute(ctx, {})

			expect(result.success).toBe(true)
			expect(result.data.source).toBe('inspector')
			expect(session.evaluate).toHaveBeenCalled()
		})

		it('should fallback to Inspector when agentClient.getMetrics returns null', async () => {
			const agentClient = createMockAgentClient(null)
			const inspectorData = { rss: 41000000, heapTotal: 5000000 }
			const session = createMockSession(inspectorData)
			const ctx = createContext({ agentClient, session })

			const result = await memoryPlugin.execute(ctx, {})

			expect(result.success).toBe(true)
			expect(result.data.source).toBe('inspector')
			expect(session.evaluate).toHaveBeenCalled()
		})
	})
})

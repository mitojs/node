import { openInspectorSession } from '../../inspector/session.js'

describe('openInspectorSession', () => {
	it('reuses an existing inspector port without sending SIGUSR1', async () => {
		const client = { close: jest.fn(), evaluate: jest.fn() }
		const deps = {
			ensurePidExists: jest.fn(),
			isPortReachable: jest.fn().mockResolvedValue(true),
			getPortOwnerPid: jest.fn().mockResolvedValue(12345),
			openInspector: jest.fn(),
			waitForInspector: jest.fn(),
			readInspectorTargets: jest.fn().mockResolvedValue([{ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/target' }]),
			connectWebSocket: jest.fn().mockResolvedValue({}),
			createClient: jest.fn().mockReturnValue(client),
		}

		const session = await openInspectorSession({ pid: 12345, port: 9229 }, deps)

		expect(session.openedByCli).toBe(false)
		expect(deps.openInspector).not.toHaveBeenCalled()
		expect(deps.waitForInspector).not.toHaveBeenCalled()
		await session.close()
		expect(client.evaluate).not.toHaveBeenCalled()
		expect(client.close).toHaveBeenCalled()
	})

	it('opens inspector when the target port is not reachable', async () => {
		const deps = {
			ensurePidExists: jest.fn(),
			isPortReachable: jest.fn().mockResolvedValue(false),
			getPortOwnerPid: jest.fn().mockResolvedValue(12345),
			openInspector: jest.fn(),
			waitForInspector: jest.fn().mockResolvedValue(undefined),
			readInspectorTargets: jest.fn().mockResolvedValue([{ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/target' }]),
			connectWebSocket: jest.fn().mockResolvedValue({}),
			createClient: jest.fn().mockReturnValue({ close: jest.fn() }),
		}

		const session = await openInspectorSession({ pid: 12345, port: 9229 }, deps)

		expect(session.openedByCli).toBe(true)
		expect(deps.openInspector).toHaveBeenCalledWith(12345)
		expect(deps.waitForInspector).toHaveBeenCalledWith(9229)
	})

	it('closes the target inspector only when it was opened by the CLI', async () => {
		const client = { close: jest.fn(), evaluate: jest.fn().mockResolvedValue(true) }
		const deps = {
			ensurePidExists: jest.fn(),
			isPortReachable: jest.fn().mockResolvedValue(false),
			getPortOwnerPid: jest.fn().mockResolvedValue(12345),
			openInspector: jest.fn(),
			waitForInspector: jest.fn().mockResolvedValue(undefined),
			readInspectorTargets: jest.fn().mockResolvedValue([{ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/target' }]),
			connectWebSocket: jest.fn().mockResolvedValue({}),
			createClient: jest.fn().mockReturnValue(client),
		}

		const session = await openInspectorSession({ pid: 12345, port: 9229 }, deps)
		await session.close()

		expect(client.evaluate).toHaveBeenCalledWith(
			expect.stringContaining("require('inspector').close()"),
			expect.any(Number)
		)
		expect(client.close).toHaveBeenCalled()
	})

	it('treats inspector connection close during target cleanup as success', async () => {
		const client = {
			close: jest.fn(),
			evaluate: jest.fn().mockRejectedValue(new Error('inspector connection closed')),
		}
		const deps = {
			ensurePidExists: jest.fn(),
			isPortReachable: jest.fn().mockResolvedValue(false),
			getPortOwnerPid: jest.fn().mockResolvedValue(12345),
			openInspector: jest.fn(),
			waitForInspector: jest.fn().mockResolvedValue(undefined),
			readInspectorTargets: jest.fn().mockResolvedValue([{ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/target' }]),
			connectWebSocket: jest.fn().mockResolvedValue({}),
			createClient: jest.fn().mockReturnValue(client),
		}

		const session = await openInspectorSession({ pid: 12345, port: 9229 }, deps)

		await expect(session.close()).resolves.toBeUndefined()
		expect(client.close).toHaveBeenCalled()
	})

	it('rejects a reachable inspector port owned by another process', async () => {
		const deps = {
			ensurePidExists: jest.fn(),
			isPortReachable: jest.fn().mockResolvedValue(true),
			getPortOwnerPid: jest.fn().mockResolvedValue(99999),
			openInspector: jest.fn(),
			waitForInspector: jest.fn(),
			readInspectorTargets: jest.fn(),
			connectWebSocket: jest.fn(),
			createClient: jest.fn(),
		}

		await expect(openInspectorSession({ pid: 12345, port: 9229 }, deps)).rejects.toThrow(
			'inspector port 9229 is owned by pid 99999, not target pid 12345'
		)
		expect(deps.connectWebSocket).not.toHaveBeenCalled()
	})
})

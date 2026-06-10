describe('MitoNode lifecycle', () => {
	beforeEach(() => {
		jest.resetModules()
	})

	it('stops the started agent on destroy', async () => {
		const stop = jest.fn().mockResolvedValue(undefined)
		const terminate = jest.fn().mockResolvedValue(undefined)

		jest.doMock('../../binary', () => ({
			initAgent: jest.fn().mockResolvedValue({ stop }),
		}))
		jest.doMock('../../init', () => ({
			DEFAULT_MITO_NODE_OPTION: {
				metrics: {},
			},
			initConfig: jest.fn(),
			initOption: jest.fn((option) => option ?? { metrics: {} }),
			initProxyThread: jest.fn().mockResolvedValue({ worker: { terminate }, port: 16667 }),
			preCheck: jest.fn(),
			SyncToAgent: jest.fn().mockResolvedValue(undefined),
		}))

		const { MitoNode } = require('../../client')
		const client = new MitoNode({
			metrics: {
				CPU: false,
				Memory: false,
			},
		})

		await client.start()
		await client.destroy()

		expect(stop).toHaveBeenCalledTimes(1)
		expect(terminate).toHaveBeenCalledTimes(1)
	})
})

describe('client module import', () => {
	beforeEach(() => {
		jest.useFakeTimers()
		jest.resetModules()
	})

	afterEach(() => {
		jest.useRealTimers()
	})

	it('does not start monitoring as an import side effect', () => {
		const initAgent = jest.fn().mockResolvedValue(undefined)

		jest.isolateModules(() => {
			jest.doMock('../../binary', () => ({
				initAgent,
			}))
			jest.doMock('../../init', () => ({
				DEFAULT_MITO_NODE_OPTION: {
					metrics: {},
				},
				initConfig: jest.fn(),
				initOption: jest.fn((option) => option ?? { metrics: {} }),
				initProxyThread: jest.fn().mockResolvedValue(undefined),
				preCheck: jest.fn(),
				SyncToAgent: jest.fn().mockResolvedValue(undefined),
			}))

			require('../../client')
		})

		expect(initAgent).not.toHaveBeenCalled()
	})
})

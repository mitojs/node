import { collectCpuProfile, collectMemory, collectProcessReport } from '../../analyze/collectors.js'

describe('analyze collectors', () => {
	it('collects memory through Runtime.evaluate', async () => {
		const client = {
			evaluate: jest.fn().mockResolvedValue({ memoryUsage: { rss: 10 } }),
		}

		await expect(collectMemory(client as any)).resolves.toEqual({ memoryUsage: { rss: 10 } })
		expect(client.evaluate).toHaveBeenCalledWith(expect.stringContaining('process.memoryUsage'), expect.any(Number))
	})

	it('collects process report through Runtime.evaluate', async () => {
		const client = {
			evaluate: jest.fn().mockResolvedValue({ header: { nodejsVersion: 'v20.0.0' } }),
		}

		await expect(collectProcessReport(client as any)).resolves.toEqual({ header: { nodejsVersion: 'v20.0.0' } })
		expect(client.evaluate).toHaveBeenCalledWith(
			expect.stringContaining('process.report.getReport'),
			expect.any(Number)
		)
	})

	it('collects cpu profile through Profiler commands', async () => {
		const client = {
			send: jest
				.fn()
				.mockResolvedValueOnce({})
				.mockResolvedValueOnce({})
				.mockResolvedValueOnce({ profile: { nodes: [] } })
				.mockResolvedValueOnce({}),
		}

		await expect(collectCpuProfile(client as any, 0)).resolves.toEqual({ nodes: [] })
		expect(client.send).toHaveBeenNthCalledWith(1, 'Profiler.enable')
		expect(client.send).toHaveBeenNthCalledWith(2, 'Profiler.start')
		expect(client.send).toHaveBeenNthCalledWith(3, 'Profiler.stop')
		expect(client.send).toHaveBeenNthCalledWith(4, 'Profiler.disable')
	})
})

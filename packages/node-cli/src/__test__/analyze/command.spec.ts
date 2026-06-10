import { toAnalyzeOptions } from '../../analyze/command.js'

describe('toAnalyzeOptions', () => {
	it('converts commander string options to analyze options', () => {
		expect(
			toAnalyzeOptions({
				pid: '12345',
				port: '9333',
				outDir: './bundles',
				duration: '3000',
			})
		).toEqual({
			pid: 12345,
			port: 9333,
			outDir: './bundles',
			duration: 3000,
		})
	})
})

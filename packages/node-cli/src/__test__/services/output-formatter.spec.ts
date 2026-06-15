import type { MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOutputFormatter } from '../../services/output-formatter'

describe('createOutputFormatter', () => {
	let stdoutWriteSpy: MockInstance
	let consoleLogSpy: MockInstance
	let consoleErrorSpy: MockInstance

	beforeEach(() => {
		stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('JSON mode (json=true)', () => {
		it('should output valid JSON to stdout', () => {
			const formatter = createOutputFormatter(true)
			const data = { success: true, command: 'memory', data: { rss: 50000000 } }

			formatter(data)

			expect(stdoutWriteSpy).toHaveBeenCalledTimes(1)
			const output = stdoutWriteSpy.mock.calls[0][0]
			expect(output.endsWith('\n')).toBe(true)
			// 验证输出是合法 JSON
			const parsed = JSON.parse(output.trim())
			expect(parsed).toEqual(data)
		})

		it('should serialize complex nested data correctly', () => {
			const formatter = createOutputFormatter(true)
			const data = {
				success: true,
				command: 'timers',
				data: { timers: [{ type: 'setTimeout', delay: 1000 }], source: 'agent' },
			}

			formatter(data)

			const output = stdoutWriteSpy.mock.calls[0][0]
			const parsed = JSON.parse(output.trim())
			expect(parsed.data.timers).toHaveLength(1)
		})

		it('should output error data as JSON too', () => {
			const formatter = createOutputFormatter(true)
			const data = { success: false, command: 'report', error: 'connection failed' }

			formatter(data)

			const output = stdoutWriteSpy.mock.calls[0][0]
			const parsed = JSON.parse(output.trim())
			expect(parsed.success).toBe(false)
			expect(parsed.error).toBe('connection failed')
		})
	})

	describe('Human mode (json=false)', () => {
		it('should log string data directly', () => {
			const formatter = createOutputFormatter(false)
			const data = { success: true, command: 'report', data: 'Report saved to /tmp/report.json' }

			formatter(data)

			expect(consoleLogSpy).toHaveBeenCalledWith('Report saved to /tmp/report.json')
		})

		it('should log object data as pretty-printed JSON', () => {
			const formatter = createOutputFormatter(false)
			const data = { success: true, command: 'memory', data: { rss: 50000000, heapTotal: 20000000 } }

			formatter(data)

			expect(consoleLogSpy).toHaveBeenCalledTimes(1)
			const output = consoleLogSpy.mock.calls[0][0]
			// 验证是带缩进的 JSON
			expect(output).toContain('"rss": 50000000')
			expect(output).toContain('    ')
		})

		it('should not output anything when success is true but data is undefined', () => {
			const formatter = createOutputFormatter(false)
			const data = { success: true, command: 'test', data: undefined } as any

			formatter(data)

			expect(consoleLogSpy).not.toHaveBeenCalled()
			expect(consoleErrorSpy).not.toHaveBeenCalled()
		})
	})

	describe('Error mode', () => {
		it('should output error message to stderr', () => {
			const formatter = createOutputFormatter(false)
			const data = { success: false, command: 'timers', error: 'SDK not loaded' }

			formatter(data)

			expect(consoleErrorSpy).toHaveBeenCalledWith('Error: SDK not loaded')
		})

		it('should output suggestion after error when provided', () => {
			const formatter = createOutputFormatter(false)
			const data = {
				success: false,
				command: 'timers',
				error: 'SDK not loaded',
				suggestion: 'Install @mitojs/node in the target process',
			}

			formatter(data)

			expect(consoleErrorSpy).toHaveBeenCalledWith('Error: SDK not loaded')
			expect(consoleErrorSpy).toHaveBeenCalledWith('Suggestion: Install @mitojs/node in the target process')
		})

		it('should not output suggestion when not provided', () => {
			const formatter = createOutputFormatter(false)
			const data = { success: false, command: 'memory', error: 'Connection refused' }

			formatter(data)

			expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
			expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Connection refused')
		})
	})
})

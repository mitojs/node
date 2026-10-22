import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const python = spawnSync('python3', ['--version'], { encoding: 'utf8' })

// PTY 是 Unix 内核接口；Windows 的功能测试仍由通用 CLI E2E 覆盖。
describe.skipIf(process.platform === 'win32' || python.status !== 0)('real terminal redraw and demo target', () => {
	let result: {
		autoSelected: boolean
		sdk: boolean
		errors: boolean
		timers: boolean
		steadyBytes: number
		erasedLines: number
		updates: number
		exitCode: number
		targetExitCode: number
		switchedToInspector: boolean
		keyboardTasks: boolean
	}
	beforeAll(() => {
		const root = path.resolve(import.meta.dirname, '../../../../..')
		const run = spawnSync(
			'python3',
			[path.join(import.meta.dirname, 'fixtures/terminal-session.py'), process.execPath, root],
			{ encoding: 'utf8', timeout: 35000 }
		)
		expect(run.status, run.stderr || run.error?.message).toBe(0)
		result = JSON.parse(run.stdout)
	}, 40000)
	it('redraws changing metrics without erasing every terminal row', () => {
		expect(result.updates).toBeGreaterThan(0)
		expect(result.erasedLines).toBe(0)
		expect(result.steadyBytes).toBeLessThan(100000)
	})
	it('automatically connects the demo SDK so empty errors and live timers are actual observations', () => {
		expect(result).toMatchObject({ autoSelected: true, sdk: true, errors: true, timers: true })
	})
	it('cleans up the UI and its own target on Ctrl+C', () => {
		expect(result).toMatchObject({ exitCode: 130, targetExitCode: 0 })
	})
	it('samples the newly selected process after leaving the preselected demo PID', () => {
		expect(result.switchedToInspector).toBe(true)
	})
	it('selects right-side tasks with arrows and then moves through parameter fields in the real terminal', () => {
		expect(result.keyboardTasks).toBe(true)
	})
})

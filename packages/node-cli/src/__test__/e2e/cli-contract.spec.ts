import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../../../../..')
const cli = path.join(root, 'packages/node-cli/dist/cli.mjs')
let target: ChildProcess
let port = 0
beforeAll(async () => {
	target = spawn(process.execPath, ['--inspect=127.0.0.1:0', '-e', 'setInterval(() => {}, 1000)'], {
		stdio: ['ignore', 'ignore', 'pipe'],
	})
	port = await new Promise<number>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('target Inspector not ready')), 5000)
		let buffer = ''
		target.stderr?.on('data', (chunk) => {
			buffer += chunk
			const match = buffer.match(/ws:\/\/127\.0\.0\.1:(\d+)/)
			if (match) {
				clearTimeout(timer)
				resolve(Number(match[1]))
			}
		})
		target.once('error', reject)
	})
})
afterAll(async () => {
	if (target && target.exitCode === null) {
		target.kill('SIGTERM')
		await new Promise((resolve) => target.once('exit', resolve))
	}
})

function command(args: string[]) {
	return spawnSync(process.execPath, [cli, ...args], {
		encoding: 'utf8',
		timeout: 10000,
		env: { ...process.env, MITO_DEBUG: '1' },
	})
}

describe('built CLI machine contract', () => {
	it('returns structured JSON and exit2 for invalid arguments', () => {
		const result = command(['memory', '--pid', 'not-a-number', '--json'])
		expect(result.status).toBe(2)
		expect(JSON.parse(result.stdout)).toMatchObject({ success: false, errorCode: 'INVALID_ARGUMENT' })
	})
	it('returns structured argument failure for missing code', () => {
		const result = command(['run-code', '--pid', String(target.pid), '--port', String(port), '--json'])
		expect(result.status).toBe(2)
		expect(JSON.parse(result.stdout)).toMatchObject({ success: false, errorCode: 'INVALID_ARGUMENT' })
	})
	it('returns exit1 when target evaluation fails', () => {
		const result = command([
			'run-code',
			'--pid',
			String(target.pid),
			'--port',
			String(port),
			'--code',
			"throw new Error('fixture evaluation failed')",
			'--json',
		])
		expect(result.status).toBe(1)
		expect(JSON.parse(result.stdout)).toMatchObject({
			success: false,
			error: expect.stringContaining('fixture evaluation failed'),
		})
	})
	it('preserves a bare falsy expression and keeps debug output out of stdout', () => {
		const result = command(['run-code', '--pid', String(target.pid), '--port', String(port), '--code', '0', '--json'])
		expect(result.status).toBe(0)
		expect(result.stdout.trim().split('\n')).toHaveLength(1)
		expect(JSON.parse(result.stdout)).toMatchObject({ success: true, data: 0 })
	})
	it('explains the TTY requirement and exits2 for redirected interactive execution', () => {
		const result = command(['--interactive'])
		expect(result.status).toBe(2)
		expect(result.stdout).toBe('')
		expect(result.stderr).toContain('TTY')
		expect(result.stderr).toContain('--json')
	})
	it('validates an explicit interactive PID before starting process selection', () => {
		const result = command(['--interactive', '--pid', 'not-a-number'])
		expect(result.status).toBe(2)
		expect(result.stdout).toBe('')
		expect(result.stderr).toContain('--pid must be a positive integer')
	})
})

import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { createTerminalOutput } from '../../tui/terminal.js'

const outputs: ReturnType<typeof createTerminalOutput>[] = []
afterEach(() => {
	for (const output of outputs.splice(0)) output.close()
})

function terminal(columns = 80, rows = 24) {
	const writes: string[] = []
	const target = Object.assign(
		new Writable({
			write(chunk, _encoding, done) {
				writes.push(String(chunk))
				done()
			},
		}),
		{ columns, rows, isTTY: true }
	) as NodeJS.WriteStream
	const output = createTerminalOutput(target)
	outputs.push(output)
	return { target, output, take: () => writes.splice(0).join('') }
}

describe('stable terminal frame output', () => {
	it('updates a changed metric without erasing or rewriting static borders and neighboring rows', () => {
		const { output, take } = terminal()
		output.stdout.write('static header\nCPU 1%\nstatic footer')
		take()
		output.stdout.write('static header\nCPU 2%\nstatic footer')
		const update = take()
		expect(update).toContain('\u001b[2;1H')
		expect(update).toContain('CPU 2%')
		expect(update).not.toContain('static header')
		expect(update).not.toContain('static footer')
		expect(update).not.toContain('\u001b[2K')
		expect(update).not.toContain('\u001b[2J')
	})
	it('emits nothing for an unchanged frame', () => {
		const { output, take } = terminal()
		output.stdout.write('same frame')
		take()
		output.stdout.write('same frame')
		expect(take()).toBe('')
	})
	it('clears obsolete text after a shorter replacement and removes rows from the previous view', () => {
		const { output, take } = terminal()
		output.stdout.write('a longer previous line\nobsolete second row')
		take()
		output.stdout.write('short')
		const update = take()
		expect(update).toContain('short\u001b[0m\u001b[K')
		expect(update).toContain('\u001b[2;1H\u001b[0m\u001b[0m\u001b[K')
	})
	it('clips stale frames to resized dimensions while preserving ANSI styles and whole Chinese characters', () => {
		const { target, output, take } = terminal()
		output.stdout.write('\u001b[36m支付服务\u001b[0m\nsecond\nthird\nfourth')
		take()
		target.columns = 5
		target.rows = 3
		output.stdout.write('\u001b[36m支付服务\u001b[0m\nsecond\nthird\nfourth')
		const update = take()
		expect(update).toContain('\u001b[36m支付')
		expect(update).not.toContain('服务')
		expect(update).toContain('secon')
		expect(update).not.toContain('third')
		expect(update).not.toContain('\u001b[4;1H')
	})
	it('passes Ink cursor control through without invalidating the current frame', () => {
		const { output, take } = terminal()
		output.stdout.write('header\ncontent')
		take()
		output.stdout.write('\u001b[?25l')
		expect(take()).toBe('\u001b[?25l')
		output.stdout.write('header\ncontent')
		expect(take()).toBe('')
	})
	it('clears the reserved bottom row after shrinking so an old pane border cannot remain under the footer', () => {
		const { target, output, take } = terminal(80, 24)
		output.stdout.write(Array.from({ length: 23 }, () => '│ old pane │').join('\n'))
		take()
		target.rows = 20
		output.stdout.write('header\nfooter')
		expect(take()).toContain('\u001b[20;1H\u001b[0m\u001b[K')
	})
	it('restores the original terminal and cursor exactly once and ignores late frames after close', () => {
		const before = process.listenerCount('exit')
		const { output, take } = terminal()
		expect(take()).toContain('\u001b[?1049h')
		output.close()
		expect(take()).toContain('\u001b[?25h\u001b[?1049l')
		output.close()
		output.stdout.write('late frame')
		expect(take()).toBe('')
		expect(process.listenerCount('exit')).toBe(before)
	})
})

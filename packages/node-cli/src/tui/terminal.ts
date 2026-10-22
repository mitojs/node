import stringWidth from 'string-width'

const csi = '\u001b['
const reset = `${csi}0m`

function fitLine(line: string, columns: number): string {
	if (stringWidth(line) <= columns) return line
	let width = 0
	let fitted = ''
	// resize 时旧布局可能比新窗口宽；保留 Ink 的 SGR 序列，禁止内容自动换行冲掉下方区域。
	// biome-ignore lint/suspicious/noControlCharactersInRegex: 此处解析的就是终端 ESC 协议序列。
	for (const token of line.match(/\u001b\[[0-?]*[ -/]*[@-~]|[^\u001b]/gu) ?? []) {
		if (token.startsWith('\u001b')) fitted += token
		else {
			const size = stringWidth(token)
			if (width + size > columns) break
			fitted += token
			width += size
		}
	}
	return fitted
}

// 只接收 Ink 的完整布局帧；stdout 保留真实 TTY 尺寸和 resize 事件，close 恢复原终端且可重复调用。
export function createTerminalOutput(target: NodeJS.WriteStream) {
	let previous: string[] = []
	let geometry = ''
	let closed = false
	target.write(`${csi}?1049h${csi}?25l`)
	const close = () => {
		if (closed) return
		closed = true
		process.off('exit', close)
		target.write(`${reset}${csi}?25h${csi}?1049l`)
	}
	process.once('exit', close)
	const write = (
		chunk: string | Uint8Array,
		encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
		callback?: (error?: Error | null) => void
	) => {
		const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
		if (closed) {
			done?.()
			return true
		}
		const frame = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
		// Ink 的根组件还会单独发送光标显示/隐藏，不能把这些控制消息当作一行正文。
		if (frame === `${csi}?25l` || frame === `${csi}?25h`) return target.write(frame, done)
		const columns = Math.max(1, target.columns || 80)
		const rows = Math.max(1, (target.rows || 24) - 1)
		const nextGeometry = `${columns}x${rows}`
		const next = frame
			.split('\n')
			.slice(0, rows)
			.map((line) => fitLine(line, columns))
		let output = ''
		for (let row = 0; row < Math.min(rows, Math.max(previous.length, next.length)); row++) {
			if (geometry === nextGeometry && next[row] === previous[row]) continue
			// 先覆盖新内容，再擦除尾部；静态边框和未变化行不参与重绘。
			output += `${csi}${row + 1};1H${reset}${next[row] ?? ''}${reset}${csi}K`
		}
		// 缩小窗口后，旧面板可能占据新的光标保留行；只在尺寸改变时清理这一行。
		if (geometry && geometry !== nextGeometry) output += `${csi}${rows + 1};1H${reset}${csi}K`
		previous = next
		geometry = nextGeometry
		if (!output) {
			done?.()
			return true
		}
		// 支持同步更新的终端一次提交；不支持该扩展时仍依靠行差异避免全屏闪烁。
		return target.write(`${csi}?2026h${output}${csi}?2026l`, done)
	}
	const stdout = new Proxy(target, {
		get(stream, key) {
			if (key === 'write') return write
			const value = Reflect.get(stream, key, stream)
			return typeof value === 'function' ? value.bind(stream) : value
		},
	})
	return { stdout, close }
}

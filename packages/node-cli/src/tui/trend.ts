import type { DashboardSample } from './model.js'

type Metric = 'cpu' | 'rss' | 'heapUsed'

interface Point {
	at: number
	value: number
	source: string
	interval: number
	expiresAt: number
	segment: number
}

export interface TrendChart {
	rows: string[]
	min: number
	max: number
	current: number | null
	average: number | null
	peak: number | null
	sampleCount: number
}

const WINDOW_MS = 60000
const NORTH = 1
const EAST = 2
const SOUTH = 4
const WEST = 8
const GLYPHS = ['─', '│', '─', '╰', '│', '│', '╭', '├', '─', '╯', '─', '┴', '╮', '┤', '┬', '┼']

function positive(value: number | undefined, fallback: number) {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function niceMaximum(value: number) {
	if (value <= 0) return 1
	const magnitude = 10 ** Math.floor(Math.log10(value))
	const normalized = value / magnitude
	return ([1, 2, 2.5, 5, 10].find((step) => step >= normalized - Number.EPSILON) ?? 10) * magnitude
}

function pointsFor(history: DashboardSample[], metric: Metric, now: number) {
	const observed = new Map<number, Point>()
	let segment = 0
	let current: Point | null = null
	for (const sample of [...history].sort((left, right) => left.at - right.at)) {
		if (!Number.isFinite(sample.at) || sample.at > now) continue
		const at = (metric === 'cpu' ? sample.cpuAt : sample.memoryAt) ?? sample.at
		if (!Number.isFinite(at) || at < now - WINDOW_MS || at > now) {
			segment++
			current = null
			continue
		}
		const source = (metric === 'cpu' ? sample.cpuSource : sample.memorySource) ?? sample.source
		const interval = positive(
			metric === 'cpu' ? sample.cpuIntervalMs : sample.memoryIntervalMs,
			source === 'agent' ? 5000 : 1000
		)
		const stale = (metric === 'cpu' ? sample.cpuStale : sample.memoryStale) ?? sample.stale
		const value = sample[metric]
		// 按各指标的原始时间独立过期，避免另一来源的旧数据截短寿命或重复轮询续期。
		const expiresAt = at + (source === 'agent' ? interval * 3 : 6000)
		if (stale || sample.at > expiresAt || value === null || !Number.isFinite(value) || value < 0) {
			// 明确失败的观察是断点，不能越过它推断未采集期间的指标值。
			segment++
			current = null
			continue
		}
		const point: Point = { at, value, source, interval, expiresAt, segment }
		current = point
		// HTTP 轮询会多次返回同一个 SDK 样本，统计只计算真实的采样时间点。
		// 恢复通信后重复的旧时间戳仍属于原来的线段，不能借它跨越中间的缺失观察。
		observed.set(at, { ...point, segment: observed.get(at)?.segment ?? segment })
	}
	return { points: [...observed.values()].sort((left, right) => left.at - right.at), current }
}

function domain(points: Point[], metric: Metric) {
	if (!points.length) return { min: 0, max: 1 }
	const values = points.map((point) => point.value)
	const minimum = Math.min(...values)
	const maximum = Math.max(...values)
	if (metric === 'cpu') return { min: 0, max: niceMaximum(maximum) }
	// 内存通常在较大基数上小幅波动；保留边距使平线与微小变化都可见。
	const padding = Math.max((maximum - minimum) * 0.1, maximum === minimum ? maximum * 0.05 : 0, 1)
	return { min: Math.max(0, minimum - padding), max: maximum + padding }
}

function gridFor(points: Point[], now: number, width: number, height: number, min: number, max: number) {
	const grid: (number | null)[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => null))
	if (!width || !height) return grid.map(() => '')
	const xFor = (at: number) => Math.round(((at - (now - WINDOW_MS)) / WINDOW_MS) * (width - 1))
	const yFor = (value: number) =>
		Math.max(0, Math.min(height - 1, Math.round(((max - value) / (max - min)) * (height - 1))))
	const drawable: Point[] = []
	let previousRaw: Point | undefined
	let segment = 0
	for (const point of points) {
		// 连续性必须先按真实相邻采样判断；列压缩后的代表点可能相隔多个正常采集周期。
		if (
			previousRaw &&
			(previousRaw.segment !== point.segment ||
				previousRaw.source !== point.source ||
				point.at - previousRaw.at > Math.max(point.interval, previousRaw.interval) * 1.5)
		)
			segment++
		const representative = { ...point, segment }
		const previousDrawn = drawable.at(-1)
		// 同一连续段的一列只画最后一个真实值，避免密集采样在单列反复折返形成竖刺。
		if (previousDrawn?.segment === segment && xFor(previousDrawn.at) === xFor(point.at))
			drawable[drawable.length - 1] = representative
		else drawable.push(representative)
		previousRaw = point
	}
	const edge = (x: number, y: number, nextX: number, nextY: number) => {
		const direction = nextX > x ? EAST : nextX < x ? WEST : nextY > y ? SOUTH : NORTH
		const opposite = direction === EAST ? WEST : direction === WEST ? EAST : direction === SOUTH ? NORTH : SOUTH
		grid[y][x] = (grid[y][x] ?? 0) | direction
		grid[nextY][nextX] = (grid[nextY][nextX] ?? 0) | opposite
	}
	let previous: Point | undefined
	for (const point of drawable) {
		const x = xFor(point.at)
		const y = yFor(point.value)
		grid[y][x] ??= 0
		if (previous && previous.segment === point.segment) {
			const fromX = xFor(previous.at)
			const fromY = yFor(previous.value)
			let cursorY = fromY
			// 用相邻单元格的连接方向生成连续线，避免点阵在五秒采样间隔下呈现孤立点。
			for (let cursorX = fromX; cursorX < x; cursorX++) {
				const nextY = Math.round(fromY + ((y - fromY) * (cursorX + 1 - fromX)) / (x - fromX))
				edge(cursorX, cursorY, cursorX + 1, cursorY)
				while (cursorY !== nextY) {
					const step = Math.sign(nextY - cursorY)
					edge(cursorX + 1, cursorY, cursorX + 1, cursorY + step)
					cursorY += step
				}
			}
			while (cursorY !== y) {
				const step = Math.sign(y - cursorY)
				edge(x, cursorY, x, cursorY + step)
				cursorY += step
			}
		}
		previous = point
	}
	return grid.map((row) => row.map((mask) => (mask === null ? ' ' : GLYPHS[mask])).join(''))
}

// 行只包含固定大小的最近一分钟网格；缺失为空白，末样本之后不外推到现在。
export function trendChart(
	history: DashboardSample[],
	metric: Metric,
	now: number,
	width: number,
	height: number
): TrendChart {
	const columns = Math.max(0, Math.floor(Number.isFinite(width) ? width : 0))
	const rows = Math.max(0, Math.floor(Number.isFinite(height) ? height : 0))
	const { points, current } = pointsFor(history, metric, now)
	const { min, max } = domain(points, metric)
	return {
		rows: gridFor(points, now, columns, rows, min, max),
		min,
		max,
		current: current && now <= current.expiresAt ? current.value : null,
		average: points.length ? points.reduce((sum, point) => sum + point.value, 0) / points.length : null,
		peak: points.length ? Math.max(...points.map((point) => point.value)) : null,
		sampleCount: points.length,
	}
}

import { describe, expect, it } from 'vitest'
import { buildSample, type DashboardSample } from '../../tui/model.js'
import { trendChart } from '../../tui/trend.js'

const sample = (at: number, cpu: number | null, extra: Partial<DashboardSample> = {}): DashboardSample => ({
	at,
	cpuAt: at,
	memoryAt: at,
	cpu,
	rss: null,
	heapUsed: null,
	heapTotal: null,
	errors: null,
	timers: null,
	source: 'agent',
	sdk: true,
	agent: true,
	ageMs: 0,
	stale: false,
	cpuIntervalMs: 5000,
	memoryIntervalMs: 5000,
	...extra,
})

const column = (rows: string[], x: number) => rows.map((row) => row[x]).join('')

describe('continuous TUI trends', () => {
	it('connects adjacent five-second SDK samples with readable line characters', () => {
		const result = trendChart([sample(50000, 10), sample(55000, 10), sample(60000, 10)], 'cpu', 60000, 61, 5)
		expect(result.rows).toHaveLength(5)
		expect(result.rows.every((row) => row.length === 61)).toBe(true)
		expect(result.rows[0]).toBe(`${' '.repeat(50)}${'─'.repeat(11)}`)
		expect(result).toMatchObject({ min: 0, max: 10, current: 10, average: 10, peak: 10, sampleCount: 3 })
	})

	it('shows a joined rising and falling curve instead of disconnected points', () => {
		const result = trendChart([sample(50000, 0), sample(55000, 10), sample(60000, 0)], 'cpu', 60000, 61, 5)
		for (let x = 50; x <= 60; x++) expect(column(result.rows, x).trim()).not.toBe('')
		expect(result.rows.join('')).toMatch(/[╭╮╰╯]/)
		expect(result.rows.join('')).not.toMatch(/[•·⠁-⣿]/)
		expect(result).toMatchObject({ current: 0, peak: 10, sampleCount: 3 })
	})

	it('plots original collection time and leaves time after the last sample blank', () => {
		const result = trendChart([sample(60000, 8, { cpuAt: 50000 })], 'cpu', 60000, 61, 5)
		expect(column(result.rows, 50).trim()).toBe('─')
		for (let x = 51; x <= 60; x++) expect(column(result.rows, x).trim()).toBe('')
		expect(result.sampleCount).toBe(1)
	})

	it('uses the same sixty-second window at different terminal widths', () => {
		const history = [sample(1000, 5), sample(60000, 10)]
		const wide = trendChart(history, 'cpu', 61000, 61, 5)
		const compact = trendChart(history, 'cpu', 61000, 31, 5)
		expect(column(wide.rows, 0).trim()).not.toBe('')
		expect(column(compact.rows, 0).trim()).not.toBe('')
		expect(column(wide.rows, 59).trim()).not.toBe('')
		expect(column(compact.rows, 30).trim()).not.toBe('')
		expect(compact.sampleCount).toBe(2)
	})

	it('keeps an explicit missing value as a gap rather than zero or a bridge', () => {
		const result = trendChart([sample(50000, 10), sample(55000, null), sample(60000, 10)], 'cpu', 60000, 61, 5)
		for (let x = 51; x <= 59; x++) expect(column(result.rows, x).trim()).toBe('')
		expect(result).toMatchObject({ average: 10, sampleCount: 2 })
		const missing = trendChart([sample(50000, 10), sample(55000, null)], 'cpu', 55000, 61, 5)
		expect(missing.current).toBeNull()
	})

	it('breaks a line at an expired observation and after a missed collection interval', () => {
		const expired = trendChart(
			[sample(50000, 10), sample(55000, 10, { stale: true }), sample(60000, 10)],
			'cpu',
			60000,
			61,
			5
		)
		expect(column(expired.rows, 55).trim()).toBe('')
		const missed = trendChart([sample(45000, 10), sample(60000, 10)], 'cpu', 60000, 61, 5)
		for (let x = 46; x <= 59; x++) expect(column(missed.rows, x).trim()).toBe('')
		expect(missed.sampleCount).toBe(2)
		expect(column(missed.rows, 45).trim()).toBe('─')
		expect(column(missed.rows, 60).trim()).toBe('─')
	})

	it('breaks source changes but preserves a healthy metric when another metric is stale', () => {
		const changed = trendChart(
			[sample(55000, 10, { cpuSource: 'agent' }), sample(60000, 10, { cpuSource: 'inspector' })],
			'cpu',
			60000,
			61,
			5
		)
		expect(column(changed.rows, 57).trim()).toBe('')
		const mixed = trendChart(
			[sample(55000, 10, { cpuStale: false, stale: true }), sample(60000, 10, { cpuStale: false, stale: true })],
			'cpu',
			60000,
			61,
			5
		)
		expect(column(mixed.rows, 57).trim()).not.toBe('')
	})

	it('does not manufacture extra samples when HTTP polls repeat an SDK timestamp', () => {
		const result = trendChart(
			[sample(50000, 10), sample(51000, 10, { cpuAt: 50000 }), sample(55000, 20)],
			'cpu',
			55000,
			61,
			5
		)
		expect(result).toMatchObject({ average: 15, sampleCount: 2 })
	})

	it('does not heal a missing observation by polling an older cached sample again', () => {
		const result = trendChart(
			[sample(50000, 10), sample(52500, null), sample(53000, 10, { cpuAt: 50000 }), sample(55000, 10)],
			'cpu',
			55000,
			61,
			5
		)
		expect(column(result.rows, 57).trim()).toBe('')
		expect(result).toMatchObject({ current: 10, sampleCount: 2 })
	})

	it('counts only the latest observation when a transport switches at the same collection timestamp', () => {
		const result = trendChart(
			[
				sample(55000, 10, { cpuSource: 'agent' }),
				sample(56000, 30, { cpuAt: 55000, cpuSource: 'inspector' }),
				sample(60000, 40, { cpuSource: 'inspector' }),
			],
			'cpu',
			60000,
			61,
			5
		)
		expect(result).toMatchObject({ average: 35, sampleCount: 2, current: 40 })
	})

	it('does not report an old value as current when the latest collection clock is in the future', () => {
		const result = trendChart([sample(55000, 10), sample(60000, 20, { cpuAt: 61000 })], 'cpu', 60000, 61, 5)
		expect(result).toMatchObject({ current: null, average: 10, sampleCount: 1 })
		expect(column(result.rows, 60).trim()).toBe('')
	})

	it('adapts a low CPU range while allowing CPU above one hundred percent', () => {
		const low = trendChart([sample(55000, 0.1), sample(60000, 0.2)], 'cpu', 60000, 61, 5)
		expect(low.min).toBe(0)
		expect(low.max).toBeLessThan(1)
		expect(low.rows[0].trim()).not.toBe('')
		const multicore = trendChart([sample(55000, 180), sample(60000, 246)], 'cpu', 60000, 61, 5)
		expect(multicore.max).toBeGreaterThanOrEqual(246)
		expect(multicore).toMatchObject({ current: 246, peak: 246 })
	})

	it('draws zero CPU as a visible baseline and leaves unavailable input empty', () => {
		const zero = trendChart([sample(55000, 0), sample(60000, 0)], 'cpu', 60000, 61, 5)
		expect(zero.rows[4].endsWith('──────')).toBe(true)
		expect(zero).toMatchObject({ current: 0, average: 0, peak: 0 })
		const absent = trendChart([sample(60000, null)], 'cpu', 60000, 61, 5)
		expect(absent.rows.every((row) => row.trim() === '')).toBe(true)
		expect(absent).toMatchObject({ current: null, average: null, peak: null, sampleCount: 0 })
	})

	it('shows RSS and heap used from memory timestamps on independent readable scales', () => {
		const history = [
			sample(55000, 5, { memoryAt: 50000, rss: 1000, heapUsed: 600 }),
			sample(60000, 10, { memoryAt: 55000, rss: 1100, heapUsed: 700 }),
		]
		const rss = trendChart(history, 'rss', 60000, 61, 5)
		const heap = trendChart(history, 'heapUsed', 60000, 61, 5)
		expect(rss).toMatchObject({ current: 1100, average: 1050, peak: 1100, sampleCount: 2 })
		expect(heap).toMatchObject({ current: 700, average: 650, peak: 700, sampleCount: 2 })
		expect(rss.min).toBeLessThan(1000)
		expect(rss.max).toBeGreaterThan(1100)
		expect(rss.rows.every((row) => row.slice(56).trim() === '')).toBe(true)
	})

	it('keeps a constant memory series visible instead of dividing by a zero range', () => {
		const result = trendChart([sample(55000, 0, { rss: 1000 }), sample(60000, 0, { rss: 1000 })], 'rss', 60000, 61, 5)
		expect(result.min).toBeLessThan(1000)
		expect(result.max).toBeGreaterThan(1000)
		expect(result.rows.some((row) => row.endsWith('──────'))).toBe(true)
	})

	it('hides invalid, future and out-of-window values without poisoning scales or averages', () => {
		const result = trendChart(
			[sample(-1, 999), sample(50000, -1), sample(55000, Number.NaN), sample(60000, 2), sample(61000, 999)],
			'cpu',
			60000,
			61,
			5
		)
		expect(result).toMatchObject({ current: 2, average: 2, peak: 2, sampleCount: 1 })
	})

	it('marks a once-valid latest value unavailable once it expires without erasing its history', () => {
		const result = trendChart([sample(40000, 10)], 'cpu', 60000, 61, 5)
		expect(result.current).toBeNull()
		expect(result.sampleCount).toBe(1)
		expect(result.rows.join('').trim()).toBe('─')
	})

	it('supports tiny and empty viewports without losing the fixed grid contract', () => {
		expect(trendChart([sample(60000, 10)], 'cpu', 60000, 1, 1).rows).toEqual(['─'])
		expect(trendChart([], 'cpu', 60000, 0, 3).rows).toEqual(['', '', ''])
		expect(trendChart([], 'cpu', 60000, 5, 0).rows).toEqual([])
	})

	it('draws the last real sample per column without turning dense fluctuations into vertical spikes', () => {
		const history = [2, 10, 2, 9, 1, 8, 2].map((cpu, index) =>
			sample(54000 + index * 1000, cpu, { cpuIntervalMs: 1000 })
		)
		const result = trendChart(history, 'cpu', 60000, 11, 5)
		expect(result.rows).toEqual([' '.repeat(11), ' '.repeat(11), ' '.repeat(11), `${' '.repeat(9)}──`, ' '.repeat(11)])
		expect(result).toMatchObject({ average: 34 / 7, peak: 10, current: 2, sampleCount: 7 })
	})

	it('keeps compressed columns connected when every original one-second sample arrived normally', () => {
		const history = Array.from({ length: 61 }, (_, index) => sample(index * 1000, 10, { cpuIntervalMs: 1000 }))
		const result = trendChart(history, 'cpu', 60000, 5, 5)
		expect(result.rows[0]).toBe('─────')
		expect(result.sampleCount).toBe(61)
	})

	it('preserves a missing observation inside a compressed column as a real line break', () => {
		const history = [sample(51000, 0), sample(52000, 10), sample(53000, null), sample(57000, 0)]
		const result = trendChart(history, 'cpu', 60000, 11, 5)
		expect(column(result.rows, 9)).toBe('─    ')
		expect(column(result.rows, 10)).toBe('    ─')
		expect(result.sampleCount).toBe(3)
	})

	it('preserves a source switch inside a compressed column without joining the two transports', () => {
		const result = trendChart(
			[
				sample(51000, 0),
				sample(52000, 10),
				sample(53000, 0, { cpuSource: 'inspector' }),
				sample(57000, 0, { cpuSource: 'inspector' }),
			],
			'cpu',
			60000,
			11,
			5
		)
		expect(column(result.rows, 9)).toBe('─   ─')
		expect(column(result.rows, 10)).toBe('    ─')
		expect(result.sampleCount).toBe(4)
	})
})

describe('per-metric trend metadata', () => {
	it('retains each collection interval, source and freshness across mixed transport snapshots', () => {
		const result = buildSample(
			{
				success: true,
				command: 'monitor-cpu',
				data: { cpuPercent: 2, source: 'agent', sampledAt: 10000, interval: 5000 },
			},
			{ success: true, command: 'monitor-memory', data: { rss: 1000, source: 'inspector' } },
			null,
			20000
		)
		expect(result).toMatchObject({
			cpuIntervalMs: 5000,
			memoryIntervalMs: 1000,
			cpuSource: 'agent',
			memorySource: 'inspector',
			cpuStale: false,
			memoryStale: false,
		})
	})

	it('does not apply an unavailable SDK collector cadence to Inspector fallback samples', () => {
		const result = buildSample(
			{ success: true, command: 'monitor-cpu', data: { cpuPercent: 2, source: 'inspector' } },
			{ success: true, command: 'monitor-memory', data: { rss: 1000, source: 'agent', sampledAt: 20000 } },
			{ metrics: {}, registeredSubjects: ['CPU', 'Memory'], intervals: { CPU: 5000, Memory: 5000 } },
			20000
		)
		expect(result).toMatchObject({ cpuIntervalMs: 1000, memoryIntervalMs: 5000 })
	})

	it('keeps fresh Inspector memory independent from stale Agent CPU timestamps and validity', () => {
		const mixed = buildSample(
			{ success: true, command: 'monitor-cpu', data: { cpuPercent: 10, source: 'agent' } },
			{ success: true, command: 'monitor-memory', data: { rss: 1000, source: 'inspector' } },
			{
				metrics: {},
				registeredSubjects: ['CPU', 'Memory'],
				updatedAt: { CPU: 1000, Memory: 2000 },
				intervals: { CPU: 1000, Memory: 1000 },
			},
			10000
		)
		expect(mixed).toMatchObject({ cpuAt: 1000, memoryAt: 10000, cpuStale: true, memoryStale: false })
		expect(trendChart([mixed], 'rss', 10000, 11, 5)).toMatchObject({ current: 1000, sampleCount: 1 })
		expect(trendChart([mixed], 'cpu', 10000, 11, 5).current).toBeNull()
	})

	it('keeps fresh Inspector CPU independent from stale Agent memory timestamps and validity', () => {
		const mixed = buildSample(
			{ success: true, command: 'monitor-cpu', data: { cpuPercent: 20, source: 'inspector' } },
			{ success: true, command: 'monitor-memory', data: { rss: 1000, source: 'agent' } },
			{
				metrics: {},
				registeredSubjects: ['CPU', 'Memory'],
				updatedAt: { CPU: 2000, Memory: 1000 },
				intervals: { CPU: 1000, Memory: 1000 },
			},
			10000
		)
		expect(mixed).toMatchObject({ cpuAt: 10000, memoryAt: 1000, cpuStale: false, memoryStale: true })
		expect(trendChart([mixed], 'cpu', 10000, 11, 5)).toMatchObject({ current: 20, sampleCount: 1 })
		expect(trendChart([mixed], 'rss', 10000, 11, 5).current).toBeNull()
	})

	it('does not refresh an explicitly timestamped Inspector value merely because its snapshot was polled again', () => {
		const mixed = (now: number) =>
			buildSample(
				{ success: true, command: 'monitor-cpu', data: { cpuPercent: 10, source: 'agent', sampledAt: now } },
				{ success: true, command: 'monitor-memory', data: { rss: 1000, source: 'inspector', sampledAt: 5000 } },
				{ metrics: {}, registeredSubjects: ['CPU', 'Memory'], intervals: { CPU: 1000, Memory: 1000 } },
				now
			)
		const earlier = mixed(10000)
		expect(trendChart([earlier], 'rss', 10000, 11, 5).current).toBe(1000)
		const expired = trendChart([earlier, mixed(12000)], 'rss', 12000, 11, 5)
		expect(expired).toMatchObject({ current: null, sampleCount: 1, average: 1000 })
	})
})

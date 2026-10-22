import { describe, expect, it } from 'vitest'
import { buildDiagnosisReport, measureGrowth, summarizeCpuProfile } from '../../services/diagnosis.js'

const profile = {
	startTime: 0,
	endTime: 10000,
	nodes: [
		{ id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1, columnNumber: -1 }, children: [2] },
		{
			id: 2,
			callFrame: { functionName: 'handleRequest', url: 'file:///app/server.js', lineNumber: 9, columnNumber: 2 },
			children: [3],
		},
		{ id: 3, callFrame: { functionName: 'hashPayload', url: 'file:///app/hash.js', lineNumber: 19, columnNumber: 0 } },
	],
	samples: [2, 3, 3, 2],
	timeDeltas: [1000, 2000, 3000, 4000],
}

describe('diagnostic evidence', () => {
	// Equal sample counts must not erase the measured unequal sample intervals or parent attribution.
	it('attributes measured CPU time to actual frames and includes child time in callers', () => {
		expect(summarizeCpuProfile(profile)).toEqual([
			{
				functionName: 'handleRequest',
				url: 'file:///app/server.js',
				line: 10,
				column: 3,
				selfTimeMs: 5,
				totalTimeMs: 10,
				sampleCount: 2,
				percent: 50,
			},
			{
				functionName: 'hashPayload',
				url: 'file:///app/hash.js',
				line: 20,
				column: 1,
				selfTimeMs: 5,
				totalTimeMs: 5,
				sampleCount: 2,
				percent: 50,
			},
		])
	})

	it('does not invent hotspots when the profiler did not capture samples', () => {
		expect(summarizeCpuProfile({ ...profile, samples: [], timeDeltas: [] })).toEqual([])
		expect(() => summarizeCpuProfile({ ...profile, endTime: -1 })).toThrow('profile')
		expect(() => summarizeCpuProfile({ ...profile, timeDeltas: [1000] })).toThrow('sample')
		expect(() => summarizeCpuProfile({ ...profile, samples: [999], timeDeltas: [1000] })).toThrow('node')
	})

	it('reports hand measured growth rates without interpreting two samples as a leak', () => {
		expect(measureGrowth(1024, 3072, 2000, 'agent')).toEqual({
			durationMs: 2000,
			start: 1024,
			end: 3072,
			delta: 2048,
			ratePerSecond: 1024,
			pattern: 'increasing',
			source: 'agent',
		})
		expect(measureGrowth(3, 1, 1000, 'agent').pattern).toBe('decreasing')
		expect(measureGrowth(0, 0, 1000, 'agent').pattern).toBe('stable')
		expect(() => measureGrowth(0, 1, 0, 'agent')).toThrow('duration')
		expect(() => measureGrowth(Number.NaN, 1, 1000, 'agent')).toThrow('finite')
	})

	it('builds shared structured evidence from real deltas, timer stacks and profile locations', () => {
		const report = buildDiagnosisReport({
			scenario: 'all',
			startedAt: '2026-10-22T01:00:00.000Z',
			completedAt: '2026-10-22T01:00:02.000Z',
			durationMs: 2000,
			cpu: { profile, filename: '/tmp/evidence.cpuprofile' },
			memory: {
				start: { heapUsed: 100, rss: 200 },
				end: { heapUsed: 200, rss: 180 },
				durationMs: 2000,
				source: 'inspector',
			},
			timers: {
				start: [{ id: 1, stack: 'at poll (/app/poll.js:10:2)', name: 'setInterval' }],
				end: [
					{ id: 1, stack: 'at poll (/app/poll.js:10:2)', name: 'setInterval' },
					{ id: 2, stack: 'at poll (/app/poll.js:10:2)', name: 'setInterval' },
					{ id: 3, stack: 'at poll (/app/poll.js:10:2)', name: 'setInterval' },
				],
				durationMs: 2000,
				source: 'agent',
			},
			unavailable: [],
		})
		expect(report.memory?.heapUsed.delta).toBe(100)
		expect(report.memory?.rss.delta).toBe(-20)
		expect(report.timers?.active).toMatchObject({ start: 1, end: 3, delta: 2, ratePerSecond: 1 })
		expect(report.timers?.growingStacks).toEqual([
			{ stack: 'at poll (/app/poll.js:10:2)', name: 'setInterval', before: 1, after: 3, delta: 2 },
		])
		expect(report.cpu?.hotspots[0].url).toBe('file:///app/server.js')
		expect(report.observations.every((item) => item.confidence === 'observed')).toBe(true)
		expect(report.observations.find((item) => item.kind === 'memory')?.suggestion).toContain('堆快照')
		expect(report.artifacts).toEqual(['/tmp/evidence.cpuprofile'])
		expect(report.source).toBe('inspector+agent')
	})

	it('does not mistake different timer identities at the same total count for growing totals', () => {
		const report = buildDiagnosisReport({
			scenario: 'timers',
			startedAt: '2026-10-22T01:00:00.000Z',
			completedAt: '2026-10-22T01:00:01.000Z',
			durationMs: 1000,
			timers: {
				start: [{ id: 1, stack: 'old', name: 'setTimeout' }],
				end: [{ id: 2, stack: 'new', name: 'setTimeout' }],
				durationMs: 1000,
				source: 'agent',
			},
			unavailable: [],
		})
		expect(report.timers?.active.pattern).toBe('stable')
		expect(report.timers?.growingStacks).toEqual([{ stack: 'new', name: 'setTimeout', before: 0, after: 1, delta: 1 }])
		expect(report.observations[0].severity).toBe('info')
	})
})

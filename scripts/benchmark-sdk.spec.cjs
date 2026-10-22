const { test } = require('node:test')
const assert = require('node:assert/strict')
const { summarize } = require('./benchmark-sdk.cjs')
test('summary uses hand-checked odd sample mean and median', () => {
	assert.deepEqual(summarize([1, 3, 5]), { count: 3, mean: 3, median: 3, min: 1, max: 5 })
})
test('summary averages the two middle values for an even sample count', () => {
	assert.deepEqual(summarize([6, 2]), { count: 2, mean: 4, median: 4, min: 2, max: 6 })
})
test('empty measurements are rejected rather than reported as zero overhead', () => {
	assert.throws(() => summarize([]), /sample/i)
})

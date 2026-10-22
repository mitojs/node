import { defineConfig } from 'vitest/config'
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'html', 'lcov'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/__test__/**'],
			reportsDirectory: '../../docs/reports/coverage/node',
		},
	},
})

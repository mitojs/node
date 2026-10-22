import { defineConfig } from 'vitest/config'
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		exclude: ['**/node_modules/**', '**/__test__/e2e/**'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'html', 'lcov'],
			include: ['src/**/*.ts', 'src/**/*.tsx'],
			exclude: ['src/**/__test__/**'],
			reportsDirectory: '../../docs/reports/coverage/cli',
		},
	},
})

import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { registerBuiltinPlugins } from '../../plugins'
import { executeDiagnostic } from '../../services/diagnostic-runner'

registerBuiltinPlugins()
let server: http.Server | undefined
afterEach(async () => {
	if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
	server = undefined
})

describe('recent error diagnostics', () => {
	it('reports SDK requirement instead of a misleading successful hint', async () => {
		expect(
			await executeDiagnostic('errors', {}, { pid: process.pid, agentPort: 19998, recordHistory: false })
		).toMatchObject({ success: false, errorCode: 'SDK_REQUIRED' })
	})
	it('returns an empty observed error set as a valid result', async () => {
		server = http.createServer((req, res) =>
			res.end(
				JSON.stringify(
					req.url === '/info'
						? {
								name: 'mitojs-agent',
								status: 'running',
								protocol_version: 1,
							}
						: {
								success: true,
								registered_subjects: ['JSError'],
								updated_at: { JSError: Date.now() },
								intervals: { JSError: 5000 },
								data: { errors: [] },
							}
				)
			)
		)
		await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
		expect(
			await executeDiagnostic(
				'errors',
				{},
				{ pid: process.pid, agentPort: (server.address() as { port: number }).port, recordHistory: false }
			)
		).toMatchObject({ success: true, data: { errors: [], source: 'agent' } })
	})
})

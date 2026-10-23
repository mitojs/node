import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { DiagnosticContext } from '../../core/types'
import { runCodePlugin } from '../../plugins/run-code'

function context(): DiagnosticContext {
	return {
		pid: process.pid,
		port: 9229,
		json: true,
		output: () => {},
		session: {
			evaluate: async (expression: string) => {
				const envelope = JSON.parse(await runInNewContext(expression))
				if (envelope.code !== 0) throw new Error(envelope.message)
				return envelope.data
			},
		},
	} as unknown as DiagnosticContext
}

describe('run-code expression and body results', () => {
	it('evaluates a bare expression as shown in CLI help', async () => {
		expect(await runCodePlugin.execute(context(), { code: '0;' })).toMatchObject({ success: true, data: 0 })
	})
	it('supports explicit return in a statement body', async () => {
		expect(await runCodePlugin.execute(context(), { code: 'const value = false; return value' })).toMatchObject({
			success: true,
			data: false,
		})
	})
	it('rejects ambiguous code plus file inputs', async () => {
		expect(await runCodePlugin.execute(context(), { code: '0', file: '/file.js' })).toMatchObject({
			success: false,
			errorCode: 'INVALID_ARGUMENT',
		})
	})
})

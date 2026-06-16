import * as fs from 'node:fs'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession, genFilename } from '../helper.js'

export const cpuProfilePlugin: DiagnosticPlugin = {
	name: 'cpuprofile',
	description: 'get cpuprofile of the target process',
	options: [{ flags: '-d, --duration <ms>', description: 'profiling duration in ms', defaultValue: '10000' }],
	async execute(ctx, options) {
		const session = await ensureSession(ctx)
		const duration = ~~options.duration || 10000
		return new Promise((resolve) => {
			session.sendMessage('Profiler.enable')
			session.sendMessage('Profiler.start')
			setTimeout(async () => {
				try {
					const data = await session.sendMessage('Profiler.stop')
					const filename = genFilename('cpuprofile')
					fs.writeFileSync(filename, JSON.stringify(data.profile))
					resolve({ success: true, data: { filename } })
				} catch (e) {
					resolve({ success: false, error: (e as Error).message })
				}
				session.sendMessage('Profiler.disable')
			}, duration)
		})
	},
}

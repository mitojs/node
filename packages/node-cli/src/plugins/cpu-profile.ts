import * as fs from 'node:fs'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { genFilename } from '../helper.js'

export const cpuProfilePlugin: DiagnosticPlugin = {
	name: 'cpuprofile',
	description: 'get cpuprofile of the target process',
	options: [{ flags: '-d, --duration <ms>', description: 'profiling duration in ms', defaultValue: '10000' }],
	async execute(ctx, options) {
		const duration = ~~options.duration || 10000
		return new Promise((resolve) => {
			ctx.session.sendMessage('Profiler.enable')
			ctx.session.sendMessage('Profiler.start')
			setTimeout(async () => {
				try {
					const data = await ctx.session.sendMessage('Profiler.stop')
					const filename = genFilename('cpuprofile')
					fs.writeFileSync(filename, JSON.stringify(data.profile))
					resolve({ success: true, data: { filename } })
				} catch (e) {
					resolve({ success: false, error: (e as Error).message })
				}
				ctx.session.sendMessage('Profiler.disable')
			}, duration)
		})
	},
}

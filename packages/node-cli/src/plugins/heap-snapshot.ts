import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession, FUNCTION_WRAPPER, genFilename } from '../helper.js'

export const heapSnapshotPlugin: DiagnosticPlugin = {
	name: 'heapsnapshot',
	description: 'get heapsnapshot of the target process',
	options: [{ flags: '-d, --dir <dir>', description: 'directory to save the snapshot' }],
	async execute(ctx) {
		const session = await ensureSession(ctx)
		const filename = genFilename('heapsnapshot')
		await session.evaluate(
			FUNCTION_WRAPPER(`
				const v8 = require('v8');
				if (typeof v8.writeHeapSnapshot === 'function') {
					v8.writeHeapSnapshot('${filename}');
				} else {
					throw new Error('Your Node.js version do not support v8.writeHeapSnapshot API.');
				}
			`)
		)
		return { success: true, data: { filename } }
	},
}

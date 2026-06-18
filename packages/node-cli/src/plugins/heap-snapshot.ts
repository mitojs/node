import { getHeapSnapshotInjectable } from '@mitojs/node-shared/recipes'
import type { DiagnosticPlugin } from '../core/plugin.js'
import { ensureSession, FUNCTION_WRAPPER, genFilename, ok } from '../helper.js'

export const heapSnapshotPlugin: DiagnosticPlugin = {
	name: 'heapsnapshot',
	description: 'get heapsnapshot of the target process',
	options: [{ flags: '-d, --dir <dir>', description: 'directory to save the snapshot' }],
	async execute(ctx) {
		const session = await ensureSession(ctx)
		const filename = genFilename('heapsnapshot')
		await session.evaluate(FUNCTION_WRAPPER(getHeapSnapshotInjectable(filename)))
		return ok({ filename })
	},
}

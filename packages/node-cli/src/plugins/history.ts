import type { DiagnosticPlugin } from '../core/plugin.js'
import { fail, ok } from '../helper.js'
import { HistoryStore } from '../services/history.js'

export const historyPlugin: DiagnosticPlugin = {
	name: 'history',
	label: '查看诊断记录',
	description: 'List, inspect or compare local diagnostic results and artifact paths',
	requiresTarget: false,
	options: [
		{ flags: '--id <id>', description: 'Read one saved diagnostic result' },
		{ flags: '--compare <id1,id2>', description: 'Compare two successful records from the same process and command' },
		{ flags: '--artifacts', description: 'List artifact paths referenced by saved results' },
	],
	async execute(_ctx, options) {
		const selections = [Boolean(options.id), Boolean(options.compare), Boolean(options.artifacts)].filter(
			Boolean
		).length
		if (selections > 1) return fail('Choose only one of --id, --compare or --artifacts', 'INVALID_ARGUMENT')
		const store = new HistoryStore({ directory: options.historyDir })
		try {
			let data: Record<string, unknown>
			if (options.id) {
				const record = await store.get(String(options.id))
				if (!record)
					return fail('History record not found', 'HISTORY_NOT_FOUND', 'List history to select an existing record ID.')
				data = { record }
			} else if (options.compare) {
				const ids = String(options.compare)
					.split(',')
					.map((id) => id.trim())
				if (ids.length !== 2 || ids.some((id) => !id))
					return fail('--compare requires two comma-separated record IDs', 'INVALID_ARGUMENT')
				data = { comparison: await store.compare(ids[0], ids[1]) }
			} else if (options.artifacts) data = { artifacts: await store.artifacts() }
			else data = { records: await store.list() }
			return ok({ ...data, directory: store.directory, warnings: store.warnings })
		} catch (error) {
			return fail(
				(error as Error).message,
				'HISTORY_ERROR',
				'Verify the history directory is readable and the selected records are compatible.'
			)
		}
	},
}

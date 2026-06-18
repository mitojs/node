export const DataSource = {
	AGENT: 'agent',
	INSPECTOR: 'inspector',
	IN_PROCESS: 'in_process',
} as const

export type DataSource = (typeof DataSource)[keyof typeof DataSource]

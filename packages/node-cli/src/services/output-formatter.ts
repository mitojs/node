import type { OutputData } from '../core/types.js'

export function createOutputFormatter(json: boolean): (data: OutputData) => void {
	return (data: OutputData) => {
		if (json) {
			process.stdout.write(JSON.stringify(data) + '\n')
		} else if (data.success && data.data !== undefined) {
			if (typeof data.data === 'string') {
				console.log(data.data)
			} else {
				console.log(JSON.stringify(data.data, null, 4))
			}
		} else if (!data.success && data.error) {
			console.error(`Error: ${data.error}`)
			if (data.suggestion) {
				console.error(`Suggestion: ${data.suggestion}`)
			}
		}
	}
}

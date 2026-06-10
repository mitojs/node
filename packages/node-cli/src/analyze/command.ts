interface AnalyzeCommandOptions {
	pid: string
	port?: string
	outDir?: string
	duration?: string
}

export function toAnalyzeOptions(options: AnalyzeCommandOptions) {
	return {
		pid: Number(options.pid),
		port: options.port === undefined ? undefined : Number(options.port),
		outDir: options.outDir,
		duration: options.duration === undefined ? undefined : Number(options.duration),
	}
}

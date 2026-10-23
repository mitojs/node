export interface TargetObject extends Error {
	functionName: string
}
function prepareStackTrace(dummyObject: TargetObject, v8StackTrace: NodeJS.CallSite[]) {
	const stack: string[] = []
	for (const frame of v8StackTrace) {
		const filename = frame.getFileName() || ''
		const lineno = frame.getLineNumber() || ''
		const column = frame.getColumnNumber() || ''
		if (dummyObject.functionName && frame.getFunctionName() !== dummyObject.functionName) {
			return `${filename}:${lineno}:${column}`
		}
		stack.push(`${filename}:${lineno}:${column}`)
	}
	return stack.join('\n')
}

export function getStackFilePath(functionName?: string, callSiteFrameIndex = 6) {
	const oldLimit = Error.stackTraceLimit
	Error.stackTraceLimit = callSiteFrameIndex
	const dummyObject = {
		functionName,
	} as TargetObject

	const v8Handler = Error.prepareStackTrace

	//@ts-ignore
	Error.prepareStackTrace = prepareStackTrace
	// 运行完 captureStackTrace 会给 target 赋值 stack 属性
	Error.captureStackTrace(dummyObject, getStackFilePath)

	// 避免 v8 懒加载，在还原 prepareStackTrace 和 stackTraceLimit 前取出 stack
	const stack = dummyObject.stack as string
	Error.prepareStackTrace = v8Handler
	Error.stackTraceLimit = oldLimit
	return stack
}

// 捕获时保留创建调用栈，诊断真正消费活跃定时器时才格式化；短命句柄不承担字符串化成本。
export function captureStackFilePath(functionName?: string, callSiteFrameIndex = 6): () => string {
	const oldLimit = Error.stackTraceLimit
	const dummyObject = { functionName } as TargetObject
	Error.stackTraceLimit = callSiteFrameIndex
	try {
		Error.captureStackTrace(dummyObject, captureStackFilePath)
	} finally {
		Error.stackTraceLimit = oldLimit
	}
	let cached: string | undefined
	return () => {
		if (cached !== undefined) return cached
		const handler = Error.prepareStackTrace
		Error.prepareStackTrace = prepareStackTrace
		try {
			cached = dummyObject.stack as string
			return cached || ''
		} finally {
			Error.prepareStackTrace = handler
		}
	}
}

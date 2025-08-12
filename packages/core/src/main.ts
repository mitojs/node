// first init mito/node
async function main() {
	if (global['__MITO_NODE__']) {
		//
		return
	}
	// 1. 检测当前进程是否已经初始化过
	global['__MITO_NODE__'] = true
	//

	// 2. 通过 UDS 创建 IPC Server

	// 3.
}

main()

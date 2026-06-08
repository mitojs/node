import { registry } from '../core/registry.js'
import { cpuProfilePlugin } from './cpu-profile.js'
import { heapSnapshotPlugin } from './heap-snapshot.js'
import { memoryPlugin } from './memory.js'
import { monitorCpuPlugin } from './monitor-cpu.js'
import { reportPlugin } from './report.js'
import { runCodePlugin } from './run-code.js'
import { startInspectPlugin } from './start-inspect.js'
import { stopInspectPlugin } from './stop-inspect.js'

export function registerBuiltinPlugins() {
	registry.register(cpuProfilePlugin)
	registry.register(heapSnapshotPlugin)
	registry.register(memoryPlugin)
	registry.register(reportPlugin)
	registry.register(startInspectPlugin)
	registry.register(stopInspectPlugin)
	registry.register(runCodePlugin)
	registry.register(monitorCpuPlugin)
}

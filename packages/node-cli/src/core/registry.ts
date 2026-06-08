import type { DiagnosticPlugin } from './plugin.js'

class PluginRegistry {
	private plugins: Map<string, DiagnosticPlugin> = new Map()

	register(plugin: DiagnosticPlugin): void {
		this.plugins.set(plugin.name, plugin)
	}

	get(name: string): DiagnosticPlugin | undefined {
		return this.plugins.get(name)
	}

	getAll(): DiagnosticPlugin[] {
		return Array.from(this.plugins.values())
	}
}

export const registry = new PluginRegistry()

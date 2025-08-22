import type { ConfigType } from './types'

/**
 * 配置管理类，支持泛型指定配置类型
 */
export class Config<T extends Record<string, any>> {
	private config: T | null = null

	/**
	 * 获取配置值
	 * @param key 配置键名，如果不传则返回整个配置对象
	 * @returns 配置值或配置对象
	 */
	get<K extends keyof T>(key?: K): K extends keyof T ? T[K] : T | null {
		return this.config && key ? (this.config[key] as any) : (this.config as any)
	}

	/**
	 * 设置配置
	 * @param data 配置数据
	 */
	set(data: T): void {
		this.config = data
	}

	/**
	 * 更新配置
	 * @param data 要更新的配置数据
	 */
	update(data: Partial<T>): void {
		if (!data) {
			return
		}
		if (!this.config) {
			this.config = {} as T
		}
		Object.assign(this.config, data)
	}

	/**
	 * 销毁配置
	 */
	destroy(): void {
		this.config = null
	}
}

export const configMap = new Config<ConfigType>()

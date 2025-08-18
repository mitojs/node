export const isString = (param: unknown) => typeof param === 'string'

// 导出 Agent 二进制管理功能
export { createAgent, getPlatformInfo, MitojsAgent } from './binary'

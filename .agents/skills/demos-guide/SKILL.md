---
name: "demos-guide"
description: "Explains demo files usage scenarios and run steps. Invoke when user asks about demos, wants to test SDK/CLI/Agent integration, or needs to verify end-to-end data flow."
---

# Demos Guide

本 Skill 说明 `demos/` 目录下各示例脚本的用途、适用场景和运行方式。

## 文件总览

| 文件 | 模块格式 | 用途 |
|------|----------|------|
| `demos/sdk_with_cli.mjs` | ESM | 验证 SDK → Agent → CLI 端到端双模通信 |
| `demos/sdk_with_cli.cjs` | CJS | 同上，CJS 格式兼容性验证 |
| `demos/listen_server.mjs` | ESM | 无 SDK 的裸 HTTP 进程，测试 CLI 纯 Inspector 模式 |

---

## sdk_with_cli.mjs / sdk_with_cli.cjs

### 什么时候用

- 修改了 SDK 采集器逻辑（CPU / 内存）后，需要确认指标能正常推送到 Rust Agent
- 修改了 Rust Agent 的 `/metrics/push` 或 `/metrics/:pid` 接口后，需要端到端验证数据流转
- 修改了 CLI 的 `memory` / `monitor-cpu` 插件后，需要验证 Agent 数据源和 Inspector 回退是否正常工作
- 需要确认 `source` 字段在 Agent 模式（`"source": "agent"`）和 Inspector 回退模式（`"source": "inspector"`）之间正确切换
- 需要验证 ESM / CJS 两种模块系统下 SDK 的初始化和运行是否一致

### 运行步骤

```bash
# 1. 启动 demo（ESM 或 CJS 任选）
node demos/sdk_with_cli.mjs
# 或
node demos/sdk_with_cli.cjs

# 2. 在另一个终端用 CLI 查询（替换 <pid> 为步骤 1 输出的 PID）
node packages/node-cli/dist/cli.mjs memory -p <pid> --json
node packages/node-cli/dist/cli.mjs monitor-cpu -p <pid> --json
```

### 预期结果

- Agent 正常运行时：输出包含 `"source": "agent"`
- Agent 未运行或不可用时：输出包含 `"source": "inspector"`

---

## listen_server.mjs

### 什么时候用

- 修改了 CLI 的 Inspector 协议连接逻辑后，需要一个干净的目标进程来测试
- 需要验证 CLI 在目标进程没有 SDK 时能否正确回退到 Inspector 注入模式
- 测试 CPU Profiling、Heap Snapshot、进程报告等纯 Inspector 功能
- 需要一个长时间运行的简单 HTTP 进程作为诊断目标

### 运行步骤

```bash
# 1. 以 Inspector 模式启动
node --inspect demos/listen_server.mjs

# 2. 在另一个终端用 CLI 连接（替换 <pid> 为步骤 1 输出的 PID）
node packages/node-cli/dist/cli.mjs memory -p <pid> --json
```

### 注意事项

- 该进程监听端口 16669，启动前确认端口未被占用
- 必须加 `--inspect` 标志启动，否则 CLI 无法通过 Inspector 协议连接

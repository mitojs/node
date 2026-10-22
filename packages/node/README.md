# @mitojs/node

Node.js 进程监控 SDK，采集 CPU、内存、JS 错误和活跃定时器，通过本地 HTTP 上报共享 Rust Agent。人可使用配套 TUI 查看状态，AI Agent 可使用 `mito-node <command> --json` 读取结构化诊断结果。

## 安装与要求

需要 Node.js `^20.19.0 || >=22.12.0`。发布版本的安装命令：

```bash
pnpm add @mitojs/node
```

当前仓库实现尚未发布到 npm；体验本轮功能请从仓库根目录使用 pnpm 10.x 和 Rust 工具链构建：

```bash
pnpm install --frozen-lockfile
pnpm build
```

SDK 导出支持 ESM `import { MitoNode } from '@mitojs/node'` 和 CommonJS `const { MitoNode } = require('@mitojs/node')`。仅导入包不会自动开始监控。

## 接入应用

```ts
import { MitoNode } from '@mitojs/node'

const monitor = new MitoNode({
	metrics: {
		CPU: { interval: 1000 },
		Memory: { interval: 1000 },
		JSError: true,
		Timeout: true,
	},
})

await monitor.start()
// 启动自己的服务器或其他业务。

// 在应用关闭流程中等待：
// await monitor.destroy()
```

一进程只允许一个活动的 `MitoNode`。重复或并发 `start()` 复用同一次启动；失败会 reject 并回滚，可修复配置后重试。`destroy()` 可重复调用并返回 Promise；等待其完成后，可以重新启动。

启动成功表示已校验 Agent 并注册当前 PID，不表示所有采样立即就绪；首次读取需等待相应采集周期。SDK 内部采样与心跳定时器不会单独维持宿主进程存活。

## 配置

所有指标默认开启，未指定项保留默认值。禁用某项时明确传 `false`。

| 选项 | 类型 | 默认值 | 行为 |
| --- | --- | --- | --- |
| `metrics.CPU` | `boolean \| { interval?: number }` | `true`，5000 ms | 进程 CPU 使用率：用户态与总负载；多核可超过 100% |
| `metrics.Memory` | `boolean \| { interval?: number }` | `true`，5000 ms | V8 堆统计、各堆空间与 `process.memoryUsage()` |
| `metrics.JSError` | `boolean` | `true` | 事件驱动的被动错误观察 |
| `metrics.Timeout` | `boolean` | `true`，5000 ms | 当前活跃 `setTimeout` / `setInterval` 快照与创建位置 |

CPU / Memory 的 `interval` 单位为毫秒，必须是有限正数。Timeout 当前只支持开关，不能通过选项设置采样周期。

例如，只启用 CPU 和内存：

```ts
const monitor = new MitoNode({
	metrics: { CPU: true, Memory: true, JSError: false, Timeout: false },
})
```

### 环境变量

在创建 SDK 前设置环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `MITO_AGENT_TCP_PORT` | `16666` | 本地 Agent HTTP 端口，范围 1–65535；CLI 使用相同的 `--agent-port` |
| `MITO_AGENT_BINARY_PATH` | 随包平台二进制路径 | 指定可信的 Agent 可执行文件，例如测试或自建产物 |

SDK 的 Agent 主机固定为 `127.0.0.1`。现有端口上的服务必须通过名称、状态与协议版本校验，普通 HTTP 服务或不兼容 Agent 会导致启动失败。

## 生命周期与数据语义

- **上传**：SDK 直接 HTTP 上报，限制重试、请求时限与每项在途请求；没有 Worker 代理或 16667 代理端口。
- **共享 Agent**：启动前校验已有服务，多个 Node.js 进程可复用同一个 Agent。SDK 每 30 秒心跳，Agent 重启后恢复注册。
- **销毁**：停止采样与监听，清理在途上传，注销自己的 PID。定时器恢复只处理自己仍直接持有的包装；后来安装的第三方包装保留，SDK 留在调用链中的中间层停止记录并透明转发。
- **Agent 退出**：SDK 自动启动的 Agent 在所有注册进程移除后空闲 30 秒退出；不会因某个 SDK 销毁而终止其他进程共享的 Agent。手动启动的 Agent 保持运行。
- **有界存储**：Agent 最多保留 100 条最近错误；SDK 当前定时器快照最多追踪 1000 个句柄，并返回截断数。已完成的定时器从当前快照移除。
- **新鲜度**：查询包含每类采样的时间和间隔；健康进程的空错误列表是有效观察，不应解释为连接失败。

错误采集使用 `uncaughtExceptionMonitor`，保留 Node 对致命异常及默认未处理拒绝的退出语义。它不负责让崩溃进程继续运行，最后一次异步错误上传也不保证在退出前完成。

## 配合 CLI / TUI

安装包含当前功能的 CLI 版本后，在另一个终端运行；将 `12345` 替换为自己应用的 PID：

```bash
mito-node --interactive
mito-node memory --pid 12345 --json
mito-node timers --pid 12345 --json
mito-node errors --pid 12345 --json
mito-node diagnose --pid 12345 --duration 6000 --scenario all --dir ./diagnosis --json
```

从源码使用时，将 `mito-node` 替换为 `node packages/node-cli/dist/cli.mjs`，命令相对于仓库根目录执行。

错误、定时器需要对应 SDK 采集项及新鲜 Agent 数据；CPU / 内存可在 Agent 数据缺失或过期时通过 Inspector 获取。默认采样周期下，组合诊断观察至少 6 秒，才有机会取得两个不同时间的快照。两点变化只描述窗口内现象，不能单独证明内存或定时器泄漏。

Inspector 诊断会校验 PID 并管理连接所有权；自定义目标 Inspector 端口时传 `--port`。仅对自己拥有的开发 / 调试进程使用诊断与代码执行功能。

## 单独订阅采样

SDK 也导出 Subject，适合需要自己消费数据的场景。单独创建的 Subject 不会自动注册或上传到 Agent：

```ts
import { CPUSubject } from '@mitojs/node'

const cpu = new CPUSubject({ interval: 1000 })
const subscription = cpu.subscribe((sample) => {
	console.log(`进程 CPU: ${sample.load.toFixed(1)}%`)
})
cpu.start()

// 在关闭流程中取消订阅；最后一个订阅释放时会停止采样并清理 collector。
// subscription.unsubscribe()
```

Subject 关闭后需要创建新实例，不能把已关闭实例重新当作活动采集器使用。对于事件型 `JSErrorSubject`，同样需要先订阅再调用 `start()` 连接事件分发。

## 构建与测试

在仓库根目录执行：

```bash
pnpm --filter @mitojs/node esm           # 仅 SDK TypeScript，清理旧产物后编译
pnpm --filter @mitojs/node watch:esm     # TypeScript 监听模式
pnpm build:rust                        # 当前平台 Agent
pnpm build                             # shared、SDK、CLI 与 Rust Agent
pnpm --filter @mitojs/node test         # Vitest 单测
pnpm --filter @mitojs/node test:coverage # V8 覆盖率
cargo test --locked --manifest-path agent/Cargo.toml
```

源码入口位于 `src/client.ts`；采集器在 `src/collector/`，Subject 在 `src/subjects/`，HTTP 请求与平台二进制管理分别在 `src/request.ts`、`src/binary.ts`。测试使用 Vitest，格式化与 Lint 使用 Biome。

## 当前验证范围

2026-10-22 已在 Darwin ARM64、真实 Node 20.19.0 / 22.22.2 上完成源码构建、干净安装和 SDK / CLI 联调；SDK 49 项单测通过，行覆盖率 81.39%。

源码与发布流水线的目标包括 darwin-arm64、darwin-x64、linux-x64-musl、linux-arm64-musl、win-x64；Windows 文件名为 `mitojs-agent-win-x64.exe`。其余四个平台当前仓库二进制仍为历史产物，公开发布前必须运行五平台新构建与 manifest 校验，不能把本地验证当作全平台验证。

高频定时器场景 CPU 配对增量中位数为 2.11 个单核百分点，包含 Agent 后 RSS 增量中位数为 12.01 MiB；这些只是当前样例测量结果，不承诺固定开销上限。测量方法、结果摘要和功能自测范围见[仓库验证说明](../../docs/validation.md)。

## 许可证

MIT

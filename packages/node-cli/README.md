# @mitojs/node-cli

Node.js 本地诊断工具。交互式 TUI 让人查看进程状态、采集证据和查找产物；CLI 为 AI Agent 和脚本提供一次调用、一条 JSON 结果，以及明确的退出码。两种入口共用同一个诊断执行器。

需要 Node.js `^20.19.0 || >=22.12.0`。以下用法对应本仓库当前实现；本轮改动尚未发布到 npm，公开包需完成发布后才包含这些能力。

## 安装与快速开始

```bash
# 使用已发布版本
npm install --global @mitojs/node-cli

# 人使用交互式诊断工作台，在进程列表中选择自己的 Node.js 进程
mito-node --interactive

# Agent / 脚本读取一次内存快照
mito-node --pid 12345 --json memory

# 采集 10 秒 CPU Profile，保存到指定目录
mito-node --pid 12345 --dir ./diagnostics --json cpuprofile --duration 10000
```

在仓库中验证当前源码，先运行根目录的 `pnpm install` 和 `pnpm build`，再将上述 `mito-node` 替换为 `node packages/node-cli/dist/cli.mjs`。

CLI 优先从本机 Rust Agent 读取目标 SDK 的有效采样；CPU 和内存数据不可用或过期时，按需连接目标进程的 Inspector。CPU Profile、堆快照、进程报告和代码执行通过 Inspector 完成。`errors` 和 `timers` 必须由目标应用接入 [`@mitojs/node`](../node/README.md) 并启用对应采集器。

## 人使用：C 版诊断工作台

```bash
mito-node --interactive
# 已知自己的目标 PID 时直接进入工作台
mito-node --interactive --pid 12345
# 目标使用自定义 Inspector / Agent 端口时
mito-node --port 9230 --agent-port 16668 --interactive
```

顶部显示目标进程、连接状态、数据来源及样本年龄，并提供「总览 / CPU / 内存 / 错误 / 定时器 / 产物」页签。宽屏下左侧展示指标、最近 60 秒的采样图和最近错误，右侧选择诊断任务并编辑采集时长、输出目录和总超时，底部列出真实历史产物。80×24 终端使用可切换区域和滚动的紧凑布局。[根 README](../../README.md) 中的画面来自真实 PTY 输出经终端单元格渲染，连接的是真实 SDK、Agent 和目标进程。

| 按键 | 操作 |
| --- | --- |
| `↑` / `↓`、`Enter` | 工作台直接选择任务，Enter 进入参数；编辑时 ↑ / ↓ 切换字段 |
| `←` / `→` | 在参数编辑之外切换页签 |
| `Tab` / `Shift+Tab` | 切换区域或参数字段 |
| `/` | 搜索进程；`Enter` 结束输入，再按一次选择 |
| `R` / `P` / `H` | 刷新进程或重试结果 / 切换目标进程 / 查看历史 |
| `X` | 展开完整启动命令或错误堆栈 |
| `PgUp` / `PgDn`、`J` / `K` | 滚动长内容 |
| `Ctrl+U` | 清空当前输入字段 |
| `Esc` / `Ctrl+C` | 返回或请求取消 / 清理连接并退出 |
| `?` | 查看完整帮助 |

工作台只重绘变化的行，退出后恢复原终端。缺失或过期的图表样本显示为 `·`，不按 0 计算。仅通过 Inspector 取得 CPU / 内存时，会明确提示错误和定时器需要接入 SDK 并连接 Agent；已接入但没有错误时显示真实的 0 条记录。`NO_COLOR=1` 可关闭颜色。

## Agent 使用：JSON 与退出码

```bash
mito-node --pid 12345 --json monitor-cpu
mito-node --pid 12345 --json monitor-memory
mito-node --pid 12345 --json errors
mito-node --pid 12345 --json run-code --code 'process.version'
```

带 `--json` 的诊断调用向 stdout 输出一条 JSON 结果，诊断日志写入 stderr。`monitor-cpu` 和 `monitor-memory` 都是单次读取；持续观察由 TUI 或调用方重复采样完成。`--interactive` 与 `--json` 不能同时使用。

结果字段：

| 字段 | 含义 |
| --- | --- |
| `success`、`command` | 是否成功、执行的命令 |
| `data` | 命令结果；指标结果中的 `source` 为 `agent` 或 `inspector` |
| `error`、`errorCode`、`suggestion` | 失败原因、机器可读错误码及可选建议 |
| `meta.elapsedMs` | 执行及连接清理耗时；参数校验失败可能没有 `meta` |
| `meta.historyId`、`meta.historyWarning` | 可选历史记录 ID 或保存历史失败的提示 |

例如，`mito-node --json memory` 缺少 PID，会输出以下结果并退出 2：

```json
{"success":false,"command":"memory","errorCode":"INVALID_ARGUMENT","error":"--pid must be a positive integer."}
```

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 诊断、连接、超时或清理失败 |
| `2` | 参数错误 |
| `130` | 请求取消 |

CPU 的 100% 约等于一个逻辑 CPU 的时间，多核可超过 100%。内存原始数值以字节为单位，RSS 包含整个进程的驻留内存，Heap 只表示 V8 堆。`run-code` 保留 `0`、`false`、空字符串和 `null` 结果；返回 `undefined` 时不包含 `data`。

## 命令

除 `history` 外，命令均需要 `--pid <pid>`。

| 命令 | 用途 | 命令参数 |
| --- | --- | --- |
| `monitor-cpu` | 读取一次进程 CPU 使用率 | — |
| `monitor-memory` | 读取一次 RSS、heapUsed、heapTotal | — |
| `memory` | 读取进程内存和 V8 堆详情 | — |
| `errors` | 读取 SDK 捕获的近期错误和堆栈 | 需要 `JSError` 采集器 |
| `timers` | 读取当前活跃定时器及创建堆栈 | 需要 `Timeout` 采集器 |
| `cpuprofile` | 保存 `.cpuprofile` 文件 | `-d, --duration <ms>`，默认 `10000` |
| `heapsnapshot` | 保存堆快照 | `-d, --dir <dir>` |
| `report` | 保存 Node.js 进程诊断报告 | `-d, --dir <dir>` |
| `diagnose` | 采集 CPU 热点、内存变化和定时器增长证据 | `-d, --duration <ms>`，默认 `3000`；`--scenario <scenario>`，默认 `all` |
| `run-code` | 在目标进程内执行表达式或 JS 函数体 | `-c, --code <code>` 或 `-f, --file <file>`，必须二选一 |
| `start-inspect` | 启用并保留目标 Inspector，返回 DevTools 地址 | — |
| `stop-inspect` | 关闭目标 Inspector | — |
| `history` | 列出、读取或比较本地诊断记录 | `--id <id>`、`--compare <id1,id2>`、`--artifacts`，至多选择一项 |

`run-code` 的函数体通过 `return` 返回值，例如 `--code 'return process.memoryUsage().rss'`。它在目标进程执行，可产生副作用，仅用于自己拥有的开发或调试进程。

### 组合诊断与历史比较

```bash
# --scenario 每次只接受 cpu、memory、timers、all 中的一个值
# 6 秒观察窗口适用于需要跨过默认 5 秒 SDK 采样周期的场景
mito-node --pid 12345 --dir ./diagnostics --json diagnose --scenario all --duration 6000

# history 不需要 PID；从返回的 records 中选择 ID
mito-node --json history
mito-node --json history --id '<record-id>'
mito-node --json history --compare '<first-id>,<second-id>'
mito-node --json history --artifacts
```

组合诊断从真实 CPU Profile 提取热点，并用不同时间的快照计算内存或定时器变化。窗口内没有两个不同 SDK 样本、数据来源变化或定时器列表被截断时，结果会说明证据不足；两点增长不能确认内存泄漏。

历史比较仅接受**同一 PID、同一命令的两条成功记录**，比较可匹配的指标与产物路径。历史默认保留最多 100 条记录、总计 10 MiB；清理历史不会删除 Profile、堆快照或报告文件。命令默认保存历史，TUI 被动刷新不保存历史。

## 全局参数与目录

| 参数 | 默认值 / 说明 |
| --- | --- |
| `-p, --pid <pid>` | 目标 Node.js PID |
| `--port <port>` | 目标已配置的 Inspector 端口，默认 `9229` |
| `--agent-port <port>` | 本机 Agent 端口，优先取 `MITO_AGENT_TCP_PORT`，否则为 `16666` |
| `--timeout <ms>` | 总诊断超时，默认 `30000` 毫秒；取消和连接清理可能需要额外的短暂等待 |
| `--dir <dir>` | 诊断产物目录，自动创建；CLI 未指定时使用系统临时目录 |
| `--history-dir <dir>` | 显式指定历史目录，优先于 `MITO_HISTORY_DIR` |
| `--no-history` | 不保存本次诊断结果 |
| `--json` | 输出单条 JSON 结果 |
| `-i, --interactive` | 打开交互式工作台 |
| `-h, --help` | 显示帮助；也支持 `<command> --help` |

未指定历史目录时，macOS 使用 `~/Library/Application Support/mito-node/history`，Linux 使用 `$XDG_DATA_HOME/mito-node/history`（默认 `~/.local/share/mito-node/history`），Windows 使用 `%LOCALAPPDATA%\mito-node\history`。

## Inspector 连接与平台边界

`--port` 连接的是目标已配置的端口，不会更改目标端口。需要自定义端口时，可先启动：

```bash
# macOS / Linux：配置端口，CLI 按需发送 SIGUSR1 激活 Inspector
node --inspect-port=9230 app.js
mito-node --pid 12345 --port 9230 --json memory

# Windows：不支持通过 SIGUSR1 激活，必须提前打开 Inspector
node --inspect=9230 app.js
```

CLI 校验 Inspector 返回的 PID 与请求目标一致，并仅连接本机端点。一次诊断结束后会保留原先已打开的 Inspector；由本次诊断激活的 Inspector 会在清理时关闭，`start-inspect` 会显式保留，`stop-inspect` 会显式关闭。

采集堆快照可能暂停目标进程。取消会终止当前等待并清理连接，已开始的目标同步操作或代码副作用不能回滚。

本轮实际运行验证为 **macOS arm64**，使用 Node.js 22.22.2 和 20.19.0 验证安装包。仓库已配置其他平台的构建和发布流程，但这些平台尚未完成本地运行验收；公开发布前需要重新构建、校验并验证对应平台的新 Agent 二进制。详见[功能、自测与覆盖率说明](../../docs/validation.md)。

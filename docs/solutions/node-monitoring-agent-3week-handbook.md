# Node 监控 Agent 2-3 周实战小册

## 0. 这本小册解决什么问题

你是前端开发工程师，目标不是先成为后端或 Rust 专家，而是在 2 到 3 周内把这个仓库里的 Node 监控 Agent 做到可演示、可 review、可继续迭代。

本小册基于当前 `master` 代码，不基于旧分支里的 `analyze/discover` 方案。当前主线已经变成：

```text
SDK 采集指标
  -> Rust Agent 本地缓存
  -> CLI 插件查询 Agent 或回退 Inspector
  -> TUI / JSON 输出给人或 AI Agent
```

完成标准不是“写完一堆文档”，而是你能解释并交付这条链路：

1. 业务进程引入 `@mitojs/node` 后，持续采集 CPU、memory、JS error、timeout。
2. SDK 启动 Rust Agent，并把指标推到 Agent 的 HTTP endpoint。
3. CLI 能用插件命令读取 Agent 数据；Agent 不可用时，能回退 Inspector 做一次性诊断。
4. 人可以用 TUI，AI Agent 可以用 `--json`。
5. 每一步都有测试、命令和 PR 边界。

## 1. 当前 master 真实状态

### 1.1 已经具备的能力

| 层 | 当前代码 | 已有能力 |
| --- | --- | --- |
| CLI | `packages/node-cli/src/bin.ts` | Commander 入口，支持 `-p/--pid`、`--port`、`--json`、`-i/--interactive` |
| CLI plugin | `packages/node-cli/src/plugins/**` | `cpuprofile`、`heapsnapshot`、`memory`、`monitor-cpu`、`monitor-memory`、`report`、`run-code`、`timers` |
| CLI service | `packages/node-cli/src/services/**` | `AgentClient`、`InspectorSession`、统一输出 formatter |
| TUI | `packages/node-cli/src/interactive-cli.tsx` | Ink/React 进程选择和插件执行入口 |
| SDK | `packages/node/src/client.ts` | 启动 Agent、注册 process、启动 subjects、推送 metrics |
| Collector | `packages/node/src/collector/**` | CPU、Memory、JS Error、Timeout 采集器 |
| Subject | `packages/node/src/subjects/**` | RxJS subject 包装采集器，按间隔发出数据 |
| Agent | `agent/src/ipc/http/endpoints/**` | `/info`、`/ipc/register_process`、`/metrics/:pid`、`/metrics/push`、`/heartbeat`、`/update_process` |
| 测试 | `packages/*/vitest.config.ts`、`agent/src/**/tests.rs` | TypeScript 已迁到 Vitest，Rust 有 endpoint/store 测试 |

### 1.2 当前不要沿用的旧假设

旧小册里提过 `mito-node analyze`、`mito-node discover`、bundle manifest 等方案。当前 `master` 没有这些命令，真实路线是插件化 CLI：

```bash
mito-node memory -p <pid> --json
mito-node monitor-cpu -p <pid> --json
mito-node timers -p <pid> --json
mito-node cpuprofile -p <pid> -d 10000 --json
mito-node -i
```

所以接下来优化目标不是“回到旧 analyze 命令”，而是把现有插件体系、SDK-Agent-CLI 链路和 TUI/JSON 双模式做稳。

### 1.3 当前最大缺口

| 缺口 | 为什么重要 | 适合谁做 |
| --- | --- | --- |
| CLI 输出 schema 不够成体系 | AI Agent 需要稳定 JSON，不适合靠人读文本 | 前端/TS |
| Agent 只保留 latest metrics | 还不能做 1 分钟窗口、趋势、告警 | TS + 少量 Rust |
| TUI 只完成基础选择执行 | 还没有监控面板、刷新、结果详情页 | 前端 |
| Inspector 生命周期仍需边界测试 | 误关用户已开的 inspector 风险较高 | TS |
| `update_process` 还只是响应文案 | 还没真正下发 start/stop/restart 到 Worker proxy | Rust + TS |
| README 与真实命令有些偏差 | 新人会照旧文档跑错 | 文档 |

## 2. 一张图理解整体架构

```text
┌──────────────────────────────────────────────────────────────┐
│ User / AI Agent                                               │
│                                                              │
│  Human: mito-node -i                                         │
│  Agent: mito-node memory -p <pid> --json                     │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                v
┌──────────────────────────────────────────────────────────────┐
│ packages/node-cli                                             │
│                                                              │
│ bin.ts                                                       │
│   -> registry.getAll()                                       │
│   -> plugin.execute(context, options)                        │
│                                                              │
│ AgentClient: GET /info, GET /metrics/:pid                    │
│ InspectorSession: SIGUSR1 + CDP WebSocket                    │
└───────────────────────────────┬──────────────────────────────┘
                                │
                 ┌──────────────┴──────────────┐
                 │                             │
                 v                             v
┌────────────────────────────┐   ┌─────────────────────────────┐
│ Target Node process         │   │ Rust Agent                   │
│                            │   │                             │
│ @mitojs/node SDK            │   │ axum HTTP server             │
│ - collectors                │   │ - process store              │
│ - subjects                  │   │ - latest metrics             │
│ - proxy worker              │   │ - registered subjects        │
│ - push /metrics/push        │   │                             │
└────────────────────────────┘   └─────────────────────────────┘
```

关键判断：

1. CLI 是入口，不负责长期采样。
2. SDK 在业务进程内，负责采样和推送。
3. Agent 是本地 sidecar，负责缓存和查询。
4. Inspector 是 fallback，适合一次性诊断，不适合长期监控。

## 3. 前端工程师需要补的 Node.js 知识

### 3.1 进程与信号

要能解释：

| 概念 | 在本项目里出现在哪里 |
| --- | --- |
| PID | CLI `-p/--pid`、Agent store key |
| `process.kill(pid, 0)` | 判断进程是否存在 |
| `SIGUSR1` | CLI 激活目标 Node Inspector |
| 子进程 | SDK `binary.ts` 启动 Rust Agent |
| 环境变量 | `MITO_AGENT_TCP_PORT` 传递 Agent 端口 |

你不需要一开始理解所有 OS 细节，但要知道：CLI attach 的对象是一个真实进程，不是浏览器里的 JS runtime。

### 3.2 Inspector / Chrome DevTools Protocol

本项目用 `InspectorSession` 做三件事：

1. 给目标进程发 `SIGUSR1`。
2. 轮询 inspector 端口。
3. 通过 WebSocket 发 CDP 命令。

最少要看懂这几个 API：

| CDP / Node API | 用途 |
| --- | --- |
| `/json` | 获取 `webSocketDebuggerUrl` |
| `Runtime.evaluate` | 在目标进程执行表达式 |
| `Profiler.start` / `Profiler.stop` | 采集 CPU Profile |
| `require('inspector').close()` | 关闭目标进程 Inspector |

边界：

- Inspector 适合临时诊断。
- Inspector 不适合长期监控。
- 不要随便关闭不是自己打开的 Inspector，这是后续要补的风险点。

### 3.3 V8 与内存

`MemoryCollector` 同时采集三类数据：

| 数据源 | 说明 |
| --- | --- |
| `process.memoryUsage()` | 进程级 RSS、heapTotal、heapUsed、external、arrayBuffers |
| `v8.getHeapStatistics()` | V8 堆整体统计 |
| `v8.getHeapSpaceStatistics()` | new/old/code/map/large object 等堆空间 |

排障时不要把所有内存都叫“堆内存”：

- `rss` 是进程常驻内存。
- `heapUsed` 是 JS 堆已用。
- `external` 常见于 Buffer、C++ addon、原生绑定。
- `heapSpaces` 可以帮你判断增长发生在哪个 V8 空间。

### 3.4 CPU 采样

项目里有两类 CPU 信息：

| 能力 | 数据含义 | 代码 |
| --- | --- | --- |
| `CPUCollector` | 基于 `process.cpuUsage()` 和 `hrtime` 的区间 CPU 使用率 | `packages/node/src/collector/cpu.ts` |
| `cpuprofile` plugin | V8 JS 调用栈采样，可导入 Chrome DevTools | `packages/node-cli/src/plugins/cpu-profile.ts` |

前者适合监控趋势，后者适合定位哪段 JS 代码耗 CPU。

### 3.5 libuv / timer / event loop

Timeout 监控不是读 Node 内置指标，而是通过 shimmer 劫持：

```text
global.setTimeout / global.setInterval
  -> wrap
  -> 记录创建 stack
  -> Subject 定期序列化为数组
  -> SDK 推到 Agent
```

要理解的边界：

- 它能告诉你 timer 在哪里创建。
- 它不能直接证明“泄漏”，只能提示长期存活、数量异常或创建位置集中。
- 后续要结合 report 里的 libuv handles 和时间窗口趋势判断。

## 4. 监控与治理知识

### 4.1 监控不是只有指标

完整监控 Agent 至少包含五件事：

| 能力 | 当前状态 | 2-3 周内目标 |
| --- | --- | --- |
| 采样 | SDK subjects 已有 | 增强配置、序列化、测试 |
| 传输 | `/metrics/push` 已有 | 统一 payload schema |
| 缓存 | Agent latest metrics | 增加小窗口或至少 bounded arrays |
| 查询 | CLI plugins 查询 Agent | 稳定 JSON 输出、source 标记 |
| 动作 | `update_process` 雏形 | 明确不做或做一个真实 start/stop demo |

### 4.2 治理要解决什么

治理不是“监管别人写代码”，而是让诊断动作可控：

| 治理点 | 为什么需要 |
| --- | --- |
| 超时 | Inspector 请求可能卡住 |
| 限频 | profile / snapshot 不能一直触发 |
| 数据上限 | errors/timers 不能无限增长 |
| 权限 | 只 attach 自己有权限的进程 |
| 审计 | JSON 输出要能留下命令、pid、source、errorCode |
| 降级 | Agent 不可用时回退 Inspector，Inspector 不可用时给建议 |

2-3 周内不做完整告警系统，但要把这些边界写进设计和测试。

### 4.3 AI Agent 需要什么

AI Agent 不应该解析 TUI，也不应该猜文本。它需要：

```json
{
  "success": true,
  "command": "memory",
  "data": {
    "source": "agent"
  }
}
```

后续优化方向：

1. 每个 plugin 输出都包含 `source`。
2. 失败时包含 `errorCode` 和 `suggestion`。
3. 所有 JSON 单行输出，方便脚本和 Agent 读取。
4. 对 snapshot/profile 文件输出绝对路径、文件类型和下一步建议。

## 5. Rust Agent 学到什么程度

你不需要先系统学习 Rust。当前阶段只需要看懂三类代码：

| Rust 文件 | 要学什么 |
| --- | --- |
| `agent/src/main.rs` | Agent 如何启动 HTTP server，如何定时清理 store |
| `agent/src/ipc/http/endpoints/metrics.rs` | HTTP endpoint 如何接收和返回 JSON |
| `agent/src/data_processor/store.rs` | `ProcessStore` 和 `ProcessMetrics` 如何保存状态 |

Rust 在这里的定位：

1. 本地常驻进程。
2. 接收 SDK 推送的 metrics。
3. 给 CLI 提供查询接口。
4. 后续可承担动作调度和本地缓存。

不要在第一阶段做：

- Rust 异步架构大重构。
- 数据库落盘。
- 跨机器上传。
- 完整 APM 后端。

## 6. 2-3 周执行路线

### 总节奏

| 周期 | 目标 | 产出 |
| --- | --- | --- |
| 第 1-2 天 | 跑通环境和代码地图 | 本地能 build/test，画出链路图 |
| 第 3-5 天 | 学 Node runtime + CLI 插件 | 修 1-2 个 CLI JSON/schema 小问题 |
| 第 6-10 天 | 学 SDK Collector/Subject + Agent store | 完成 metrics payload 和 bounded 缓存改造 |
| 第 11-15 天 | 学 TUI/AI Agent 双模式 + E2E | 完成端到端 demo 和文档 |

如果时间只有 2 周，砍掉 TUI 深化，只保留 JSON/CLI/SDK/Agent 主链路。

如果有 3 周，第 3 周补 TUI、治理边界和 demo。

## 7. 第 1 阶段：环境与代码地图

### 7.1 学习目标

你要能回答：

1. CLI 插件在哪里注册？
2. SDK 如何启动 Rust Agent？
3. Agent 如何保存 metrics？
4. CLI 什么时候走 Agent，什么时候走 Inspector？

### 7.2 必跑命令

```bash
pnpm install
pnpm --filter @mitojs/node-cli test
pnpm --filter @mitojs/node test
cd agent && cargo test
```

如果需要验证完整构建：

```bash
pnpm --filter @mitojs/node build
pnpm --filter @mitojs/node-cli build
```

### 7.3 读代码顺序

1. `GOAL.md`
2. `packages/node-cli/src/bin.ts`
3. `packages/node-cli/src/plugins/memory.ts`
4. `packages/node-cli/src/services/agent-client.ts`
5. `packages/node/src/client.ts`
6. `packages/node/src/collector/memory.ts`
7. `agent/src/ipc/http/endpoints/metrics.rs`
8. `agent/src/data_processor/store.rs`

### 7.4 第一阶段 PR

PR 名称建议：

```text
docs(architecture): add node monitoring implementation map
```

范围：

- 只改文档。
- 更新 README 或新增 docs，说明 master 真实架构。
- 不改代码。

验收：

- 新人能按文档找到 CLI、SDK、Agent 三个入口。
- 文档不提 master 不存在的 `analyze/discover` 命令。

## 8. 第 2 阶段：CLI 插件与 JSON 合约

### 8.1 学习目标

前端工程师最容易上手的是 CLI 和 TUI，因为它们都是 TypeScript/React。

要掌握：

1. `DiagnosticPlugin` 接口。
2. `registry.register(plugin)`。
3. `DiagnosticContext` 里的 `session` 和 `agentClient`。
4. `createOutputFormatter(json)`。

### 8.2 推荐改造

先做低风险、小收益明确的改造：

1. 给每个 plugin 的 JSON 输出补稳定字段。
2. 统一失败输出的 `errorCode` 和 `suggestion`。
3. 给 profile/snapshot/report 输出补绝对路径。
4. 给 `monitor-cpu`、`monitor-memory`、`timers` 明确 `source: agent | inspector`。

不要一上来做：

- 新增复杂 `analyze` 聚合命令。
- 重写 Commander 入口。
- 改 TUI 大布局。

### 8.3 推荐测试

已有测试位置：

```text
packages/node-cli/src/__test__/plugins/*.spec.ts
packages/node-cli/src/__test__/services/*.spec.ts
```

新增测试优先级：

1. plugin 在 Agent 有数据时不调用 Inspector。
2. plugin 在 Agent 没数据时回退 Inspector。
3. `--json` 输出是单行 JSON。
4. 失败时有 `success: false`、`command`、`error`。

### 8.4 第二阶段 PR

PR 名称建议：

```text
refactor(node-cli): stabilize plugin json output
```

验收命令：

```bash
pnpm --filter @mitojs/node-cli test
pnpm --filter @mitojs/node-cli build
```

## 9. 第 3 阶段：SDK Collector/Subject

### 9.1 学习目标

你要理解这个模式：

```text
Collector 负责拿数据
Subject 负责调度和分发
MitoNode client 负责启动和推送
```

关键代码：

| 文件 | 重点 |
| --- | --- |
| `collector/base.ts` | collector 生命周期 |
| `subjects/base.ts` | interval、teardown |
| `client.ts` | subjects 初始化和推送 |
| `request.ts` | SDK 到 Agent HTTP 请求 |

### 9.2 推荐改造

优先做真实边界：

1. `JSErrorCollector` 重复订阅 TODO：避免重复注册或重复回调。
2. `TimeoutSubject` 的数组上限：避免 timers 无限增长。
3. errors/timers payload 标准化：确保 JSON safe。
4. `MitoNode.destroy()` 真正释放 subject、timer、全局 flag。

不要过度设计：

- 不要先抽复杂插件系统。
- 不要引入数据库。
- 不要做完整告警。

### 9.3 推荐测试

```bash
pnpm --filter @mitojs/node test
```

重点补：

1. `destroy()` 后不再推送 metrics。
2. `TimeoutSubject` 输出数组有稳定 shape。
3. JS error 只推送一次。
4. metrics disabled 时不启动对应 subject。

### 9.4 第三阶段 PR

PR 名称建议：

```text
fix(node): harden subject lifecycle and metric payloads
```

验收：

- SDK 单测过。
- 手动 demo 中 `memory`、`monitor-cpu` 能从 Agent 读取到 `source: agent`。

## 10. 第 4 阶段：Rust Agent store 与治理边界

### 10.1 学习目标

你只需要掌握：

1. axum route 怎么挂。
2. request/response struct 怎么 serde。
3. `PROCESS_DATA` 怎么保存进程状态。
4. Rust test 怎么验证 endpoint。

### 10.2 推荐改造

当前 `ProcessMetrics` 里 `errors` 和 `timers` 是 Vec，长期运行会无限增长。2-3 周内建议先做 bounded 缓存：

| 字段 | 建议 |
| --- | --- |
| `errors` | 保留最近 20 条 |
| `timers` | 保留最近 100 条或按最新 snapshot 覆盖 |
| `last_updated` | 每次 push 更新 |
| unknown subject | 记录 debug 或返回明确 success/ignored |

这比引入完整时序数据库更现实。

### 10.3 推荐测试

```bash
cd agent
cargo test
```

重点补：

1. errors 超过上限会淘汰旧数据。
2. timers 超过上限会淘汰旧数据。
3. register process 会保存 `registered_subjects`。
4. `/metrics/:pid` 返回 registered subjects。

### 10.4 第四阶段 PR

PR 名称建议：

```text
feat(agent): bound metric buffers for long-running processes
```

验收：

- Rust tests 通过。
- CLI 查询仍能拿到 metrics。

## 11. 第 5 阶段：端到端链路

### 11.1 目标

把“我写了 SDK/Agent/CLI”变成“我能演示完整排障链路”。

当前已有 E2E 测试：

```text
packages/node-cli/src/__test__/e2e/full-flow.spec.ts
```

它依赖：

```text
demos/sdk_with_cli.mjs
packages/node-cli/dist/cli.mjs
```

### 11.2 推荐 demo

准备一个 demo 进程：

1. 启动 SDK。
2. 定期制造内存增长。
3. 创建几个 timer。
4. 可选触发未捕获错误。

然后执行：

```bash
node demos/sdk_with_cli.mjs
node packages/node-cli/dist/cli.mjs memory -p <pid> --json
node packages/node-cli/dist/cli.mjs monitor-cpu -p <pid> --json
node packages/node-cli/dist/cli.mjs timers -p <pid> --json
```

验收：

1. `memory` 优先显示 `source: agent`。
2. `monitor-cpu` 能返回 CPU 数字。
3. `timers` 能说明 SDK 未加载、Agent 无数据或返回 timer 数据。
4. Agent 不可用时 CLI fallback 到 Inspector，并给出清晰错误。

### 11.3 第五阶段 PR

PR 名称建议：

```text
test(architecture): cover sdk agent cli diagnostic flow
```

范围：

- 只补 demo、E2E、文档。
- 不混入 SDK/Agent 重构。

## 12. 第 6 阶段：TUI 与前端体验

如果只有 2 周，这一阶段可跳过。如果有第 3 周，前端工程师最适合补 TUI。

### 12.1 当前 TUI

当前入口：

```bash
mito-node -i
```

代码：

```text
packages/node-cli/src/interactive-cli.tsx
```

已有能力：

1. 列出 Node 进程。
2. 选择插件。
3. 执行插件。

### 12.2 推荐优化

1. 进程列表显示 SDK/Agent 状态。
2. 插件列表按场景分组：CPU、Memory、Timer、Report。
3. 执行结果页显示 `source`、summary、下一步建议。
4. 错误页显示 suggestion。
5. 加一个刷新键，不重启 TUI。

### 12.3 不建议现在做

- 复杂图表。
- 多进程 dashboard。
- 远程机器管理。
- 上传平台。

## 13. PR 拆分建议

用 2-3 周完成时，不要一个 PR 做完所有事。建议拆成 5 个 PR：

| PR | 主题 | 预计时间 | 主要文件 |
| --- | --- | --- | --- |
| 1 | master 架构和学习地图 | 0.5 天 | `docs/**` |
| 2 | CLI JSON/schema 稳定 | 2-3 天 | `packages/node-cli/src/plugins/**`、tests |
| 3 | SDK subject 生命周期和 payload | 3-4 天 | `packages/node/src/**`、tests |
| 4 | Agent bounded metrics store | 2-3 天 | `agent/src/**`、Rust tests |
| 5 | E2E demo + TUI/文档 | 3-5 天 | `demos/**`、E2E、`interactive-cli.tsx`、docs |

如果只能做 2 周：

1. PR 1 必做。
2. PR 2 必做。
3. PR 3 必做。
4. PR 4 做 bounded store 的最小版。
5. PR 5 只做 E2E，不做 TUI 深化。

## 14. 每天怎么学

### Day 1

- 跑通 test/build。
- 读 `GOAL.md`。
- 画出 SDK -> Agent -> CLI 图。

### Day 2

- 读 `bin.ts` 和 plugins。
- 跑 `memory --json`、`monitor-cpu --json`。
- 写一页“CLI 什么时候走 Agent，什么时候走 Inspector”。

### Day 3

- 读 `InspectorSession`。
- 学 `Runtime.evaluate`、`Profiler.start/stop`。
- 给一个 plugin 补 JSON 测试。

### Day 4-5

- 稳定 CLI schema。
- 补 Vitest。
- 开 PR 2。

### Day 6

- 读 `MitoNode.start()`。
- 读 Collector/Subject。
- 跑 SDK demo。

### Day 7-8

- 修 subject 生命周期或 payload。
- 补 `@mitojs/node` tests。

### Day 9-10

- 读 Agent endpoint/store。
- 做 bounded metrics store。
- 补 Rust tests。

### Day 11-12

- 跑 E2E。
- 补 demo。
- 整理端到端排障说明。

### Day 13-15

- 做 TUI 小优化或补治理文档。
- 准备最终 demo 和 PR 汇总。

## 15. 验收清单

2-3 周结束时，至少满足：

```text
[ ] 我能解释 Node 进程、Inspector、V8 memory、CPU profile、timer tracking。
[ ] 我能解释 SDK Collector/Subject 的职责。
[ ] 我能解释 Rust Agent 只做本地 sidecar，不是完整后端。
[ ] CLI plugin JSON 输出稳定，AI Agent 可解析。
[ ] SDK metrics 可以推到 Agent。
[ ] Agent store 不会无限增长。
[ ] CLI 可以优先查 Agent，必要时回退 Inspector。
[ ] 有 E2E 或手动 demo 证明 SDK -> Agent -> CLI。
[ ] README/docs 不再误导新人跑不存在的命令。
```

## 16. 常见误区

### 误区 1：先学完整 Rust

不需要。先会改 endpoint、store、test。

### 误区 2：把监控做成大平台

不要。先做好本地 Agent，稳定 JSON 和 demo。

### 误区 3：所有诊断都靠 Inspector

Inspector 是 fallback，不是长期监控方案。

### 误区 4：TUI 和 AI Agent 输出混在一起

不要。TUI 给人，`--json` 给程序。

### 误区 5：看到 memory 变大就说泄漏

不够。需要趋势、heap space、snapshot、timer/report 证据。

## 17. 推荐最终汇报口径

可以这样汇报：

> 我基于当前 master 的插件化 CLI、SDK Collector/Subject 和 Rust Agent HTTP store，完成了一个本地 Node 监控 Agent 的 2-3 周执行路线。第一阶段先稳定 CLI JSON 和 Inspector fallback，第二阶段补 SDK metrics 生命周期和 payload，第三阶段把 Agent store 做成可长期运行的 bounded 缓存，最后用 E2E 和 TUI 小优化证明 SDK -> Agent -> CLI 的完整链路。Rust 只作为本地 sidecar，不把项目扩成完整 APM 后端。

## 18. 参考代码索引

| 主题 | 文件 |
| --- | --- |
| CLI 入口 | `packages/node-cli/src/bin.ts` |
| 插件接口 | `packages/node-cli/src/core/plugin.ts` |
| 插件注册 | `packages/node-cli/src/plugins/index.ts` |
| Agent 查询 | `packages/node-cli/src/services/agent-client.ts` |
| Inspector | `packages/node-cli/src/services/inspector-session.ts` |
| TUI | `packages/node-cli/src/interactive-cli.tsx` |
| SDK 入口 | `packages/node/src/client.ts` |
| SDK 初始化 | `packages/node/src/init.ts` |
| SDK 请求 Agent | `packages/node/src/request.ts` |
| Collector | `packages/node/src/collector/**` |
| Subject | `packages/node/src/subjects/**` |
| Agent store | `agent/src/data_processor/store.rs` |
| Agent metrics endpoint | `agent/src/ipc/http/endpoints/metrics.rs` |
| Agent process register | `agent/src/ipc/http/endpoints/register_process.rs` |
| E2E | `packages/node-cli/src/__test__/e2e/full-flow.spec.ts` |

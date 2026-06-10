# Node 监控小册：从进程诊断到 CLI + NodeAgent

## 0. 小册定位

本文档是 `@mitojs/node` 仓库的学习和交付手册，目标是让开发者一边学习 Node.js 监控和后端基础知识，一边把当前仓库逐步推进到可用的 `mito-node` CLI 和 NodeAgent。

本小册不是单纯的读书笔记，也不是一次性大方案。它的作用是把学习路线、代码路线、PR 拆分和验收方式放到一张图里，后续每推进一节，都可以独立开分支、提 PR、review、合入。

### 0.1 会话上下文

- `sessionId`: `019d953d-601f-7383-8aab-0bcbd296c783`
- `workspace`: `/Users/bytedance/Documents/CodeBase/Demo/node`
- `date`: `2026-06-02`
- `last local review`: `2026-06-11`
- `target`: macOS / Linux + Node.js 20+
- `package manager`: pnpm 10+
- `source planning doc`: <https://yx6r1z9aofl.feishu.cn/docx/Ofj2d0UwWoWxVUxEBd1cK9AWnrc>
- `source revision`: `524`

本次会话已经收敛出的核心判断：

1. 首先稳定 `@mitojs/node-cli`，不要一开始就把 Rust Agent、MCP、上传平台都拉进来。
2. CLI 要同时服务人和 Agent：人使用交互式 TUI，Agent 使用快捷参数和稳定 JSON。
3. 第一刀先做 `mito-node analyze --pid <pid> --json`，把采集链路跑通。
4. 后续再补 `mito-node discover`、Codex Skill、Claude Code 适配和 NodeAgent。
5. 每一节都应该是一个可 review 的小 PR，不做混杂大 PR。

2026-06-11 本地复核补充：

1. `packages/node-cli/src/bin.ts` 仍然是全局 `--pid` + 低层子命令模式，还没有稳定的 `discover/analyze` 合约。
2. `packages/node-cli/src/cli.ts` 仍然直接发送 `SIGUSR1`、默认连接 `9229`，并在结束时调用 `require('inspector').close()`，因此 inspector 生命周期仍是首要风险。
3. `packages/node/src/client.ts` 已能启动 Rust Agent 和 proxy thread，但 subject 初始化和 SDK 到 Agent 的指标上报链路还没有真正启用。
4. `agent/src/main.rs` 已有 axum/tokio HTTP 服务启动骨架，store、subscribe、endpoint 仍需要按 NodeAgent MVP 分阶段补齐。
5. 因此当前执行顺序不变：先用 CLI 跑通一次性诊断闭环，再做 skill 适配，最后推进 SDK + Agent 长期监控链路。

### 0.2 飞书原始规划补充

飞书文档里对这个项目的定位比“做一个 CLI 工具”更大。它有三个核心动机：

1. 对过去一年多 Node APM 经验做一次工程化收口，把 Slardar Node(Node APM) 日常开发和运维里积累的能力沉淀成开源项目。
2. 补开源社区里的空缺：目前还缺一个可以动态注入代码、通过终端交互监控 Node 进程指标、并录制线上进程 Profile 的完整工具。
3. 做一个完全开源的 Node 监控和诊断工具，为前端和 Node 服务端方向留下可复用的工程资产。

因此，本小册后续要同时覆盖两条线：

1. **一次性诊断线**：`mito-node analyze/discover`，通过 inspector 拉取 memory、report、cpuprofile，生成 bundle，给人和 Agent 使用。
2. **长期监控线**：业务进程接入 `@mitojs/node` SDK，启动 Agent，持续采集 Metrics，通过 UDS/TCP 通信和 CLI/TUI 展示。

这两条线不能混在第一刀里一起做。第一刀仍然先做 CLI 诊断闭环，但后续 PR 路线必须把 SDK、Subject、Agent、UDS、自动触发 Profile 明确排进去。

## 1. 总目标

这个项目最终要形成三层能力。

### 1.1 第一层：稳定的本地诊断 CLI

`mito-node` 能直接分析一个正在运行的 Node.js 进程：

```bash
mito-node discover --json
mito-node analyze --pid 12345 --json
```

CLI 负责做五件事：

1. 找到 Node 进程。
2. 判断目标进程是否已经开启 inspector。
3. 必要时开启 inspector，并连接到正确目标。
4. 采集 `memory`、`process.report`、`cpu.cpuprofile`。
5. 写入本地 bundle，并输出稳定 JSON。

这里的 CLI 指的是当前仓库里的 `@mitojs/node-cli` 包，也就是最终安装后用户执行的 `mito-node` 命令。

### 1.2 第二层：Agent 友好的机器接口

Agent 不适合读交互式输出，也不应该从 TUI 里抠文本。Agent 需要的是稳定、短、可解析的 JSON。

Agent 调用方式应该长这样：

```bash
mito-node analyze --pid 12345 --duration 10000 --json
```

输出不是一大段诊断结论，而是一张索引表：

```json
{
  "status": "success",
  "pid": 12345,
  "bundleDir": "/tmp/mito-node/12345-20260602-153000",
  "artifacts": {
    "manifest": {
      "path": "/tmp/mito-node/12345-20260602-153000/manifest.json",
      "status": "ok"
    },
    "summaryJson": {
      "path": "/tmp/mito-node/12345-20260602-153000/summary.json",
      "status": "ok"
    },
    "summaryMd": {
      "path": "/tmp/mito-node/12345-20260602-153000/summary.md",
      "status": "ok"
    },
    "memory": {
      "path": "/tmp/mito-node/12345-20260602-153000/memory.json",
      "status": "ok"
    },
    "report": {
      "path": "/tmp/mito-node/12345-20260602-153000/process.report.json",
      "status": "ok"
    },
    "cpuProfile": {
      "path": "/tmp/mito-node/12345-20260602-153000/cpu.cpuprofile",
      "status": "ok"
    }
  },
  "readOrder": [
    "summaryMd",
    "summaryJson",
    "memory",
    "report",
    "cpuProfile"
  ],
  "warnings": [],
  "errors": []
}
```

Agent 拿到这个 JSON 后，只需要按 `readOrder` 读取 bundle 里的文件，再输出诊断。

### 1.3 第三层：长期运行的 NodeAgent

CLI 是一次性采集，NodeAgent 是长期运行。

后续 NodeAgent 要解决的问题不是“手动分析某个 PID”，而是：

1. SDK 集成到业务进程后自动上报运行指标。
2. Rust Agent 或 NodeAgent 作为 sidecar 接收和缓存数据。
3. CLI 或 Agent 工具可以查询历史指标、订阅实时指标、触发诊断动作。

所以路线要分清：

- CLI 首版：面向本地一次性诊断。
- NodeAgent 后续：面向长期监控、进程注册、指标订阅、动作下发。

## 2. 当前仓库现状

### 2.1 当前已经有的基础

仓库当前分三层：

| 层 | 路径 | 当前能力 |
| --- | --- | --- |
| CLI | `packages/node-cli` | 通过 Inspector 连接目标 Node 进程，已有 `cpuprofile`、`heapsnapshot`、`report`、`memory`、`run-code` 等低层命令 |
| SDK | `packages/node` | 有 collector、subject、binary、proxy thread 等基础结构 |
| Rust Agent | `agent` | 有 axum/tokio HTTP 服务、IPC、store、metrics 等雏形 |

关键文件：

| 文件 | 作用 |
| --- | --- |
| `packages/node-cli/src/bin.ts` | 当前 `mito-node` 的 Commander 入口 |
| `packages/node-cli/src/cli.ts` | 当前 inspector 连接、采集、远程执行逻辑 |
| `packages/node-cli/src/constants.ts` | 当前低层命令定义 |
| `packages/node-cli/src/shared/command.ts` | 当前进程发现逻辑 |
| `packages/node-cli/src/interactive-cli.tsx` | TUI 入口雏形 |
| `packages/node/src/client.ts` | SDK 启动 Rust Agent 和 proxy thread 的主入口 |
| `agent/src/main.rs` | Rust Agent 入口 |
| `agent/src/data_processor/store.rs` | Agent 数据存储雏形 |
| `agent/src/data_processor/subscribe.rs` | Agent 订阅处理雏形 |

### 2.2 当前最关键的问题

| 优先级 | 问题 | 影响 |
| --- | --- | --- |
| P0 | 没有稳定 `discover/analyze` 合约 | Codex、Claude Code、脚本都无法稳定接入 |
| P0 | inspector 生命周期不安全 | 可能误连进程，也可能关闭用户原本开启的 inspector |
| P0 | 进程发现太弱 | 只靠 `pgrep node`，没有端口归属和 PID 校验 |
| P0 | bundle 结构未定义 | Agent 不知道读哪个文件，也不知道哪些采集失败 |
| P1 | `upload()` 是空实现 | 在线 URL 输出不可信 |
| P1 | `monitor-cpu` 是随机数据 | 不能作为正式监控能力 |
| P1 | TUI 和 Agent 模式没有清晰边界 | 人机使用方式会互相污染 |
| P2 | SDK 到 Rust Agent 主链路未完成 | 长期 NodeAgent 还不能作为首版依赖 |

## 3. 学习路线总览

学习路线按“能看见、能采集、能解释、能自动化、能长期运行”推进。

```text
Node 进程基础
      |
      v
Inspector / CDP
      |
      v
memory / report / cpuprofile
      |
      v
bundle + JSON contract
      |
      v
Codex / Claude Code adapter
      |
      v
NodeAgent / SDK / IPC
```

每一节都要同时回答五个问题：

1. 这节要学什么后端知识？
2. 这节对应仓库里的哪些代码？
3. 这节要实现什么最小能力？
4. 这节怎么验证？
5. 这节怎么拆成独立 PR？

## 4. PR 拆分总原则

后续不要把所有东西塞进一个大 PR。每节一个 PR，PR 要能单独 review。

### 4.1 每个 PR 的固定结构

每个 PR 描述建议固定成这样：

```markdown
## Summary
- 本 PR 完成小册第 N 节：<章节名>。
- 主要改动：<一到三条核心改动>。

## Learning Focus
- 本节对应的 Node / 后端知识点：<知识点>。

## CLI Contract
- 是否修改稳定命令：yes/no。
- 是否修改 JSON schema：yes/no。
- 是否修改 bundle layout：yes/no。

## Verification
- [ ] pnpm --filter @mitojs/node-cli build
- [ ] 手工运行 <命令>
- [ ] 检查 bundle 文件
- [ ] 检查 --json 输出

## Risks
- <风险和回滚方式>
```

### 4.2 每个 PR 的硬边界

每个 PR 最多做一类事情：

1. 只做命令入口。
2. 只做进程发现。
3. 只做 inspector 生命周期。
4. 只做某个 collector。
5. 只做 bundle schema。
6. 只做 Agent 适配文档或 skill。
7. 只做 NodeAgent 链路。

不要在同一个 PR 里同时改 CLI 合约、TUI、Rust Agent 和测试体系。

### 4.3 分支命名建议

建议按章节建分支：

```text
codex/node-monitoring-01-cli-entry
codex/node-monitoring-02-discover
codex/node-monitoring-03-inspector-session
codex/node-monitoring-04-memory-report
codex/node-monitoring-05-cpu-profile
codex/node-monitoring-06-bundle-contract
codex/node-monitoring-07-agent-json
codex/node-monitoring-08-codex-skill
codex/node-monitoring-09-claude-code
codex/node-monitoring-10-node-agent
codex/node-monitoring-11-sdk-agent-pipeline
codex/node-monitoring-12-release-hardening
```

### 4.4 Superpower 协作方式

这个项目适合用 superpower 辅助，但 superpower 不应该替代产品边界判断。推荐把它当作“每个 PR 的执行纪律”，而不是一次性大而全的自动实现器。

每个 PR 按下面的顺序推进：

1. **using-superpowers**：每轮开始先确认有没有适用 skill，避免跳过必要流程。
2. **brainstorming**：如果该 PR 会改变公开合约、架构边界或用户工作流，先形成短设计，再进入实现。
3. **writing-plans**：把已确认的设计拆成可执行步骤，明确文件、测试、验收命令。
4. **test-driven-development**：对稳定 JSON、bundle layout、状态计算、错误语义这类合约先写测试或测试清单。
5. **verification-before-completion**：完成后必须跑构建、测试或可替代的手工验证，不能只凭阅读代码判断完成。
6. **requesting-code-review / check**：PR 前做一次 review，重点看误连进程、关闭用户 inspector、JSON 漂移、敏感信息泄露和破坏 TUI 的风险。

这里的关键点是：superpower 负责把执行过程变稳，`mito-node` 的稳定接口仍然只由本小册定义。

### 4.5 每个 PR 的执行循环

建议每个 PR 固定走一个小闭环：

```text
pick one handbook section
  |
  v
confirm scope and non-goals
  |
  v
write or update focused tests
  |
  v
implement the smallest useful slice
  |
  v
run verification commands
  |
  v
update handbook PR status
  |
  v
open PR with command output and artifact evidence
```

每个 PR 的人机分工：

| 环节 | 人负责 | Codex / superpower 负责 |
| --- | --- | --- |
| 选题 | 决定当前要推进哪一节 | 给出风险、依赖和建议顺序 |
| 设计 | 确认公开合约和不做项 | 写短设计、指出遗漏 |
| 实现 | 审阅方向和取舍 | 修改代码、补测试、跑验证 |
| 证据 | 判断是否够合入 | 收集命令输出、bundle 列表、JSON 样例 |
| PR | 做最终 review | 生成 PR 描述和变更摘要 |

### 4.6 首批 PR 的 superpower 触发建议

| PR | 主要 skill | 原因 |
| --- | --- | --- |
| `08 - implement first analyze command` | `brainstorming` -> `writing-plans` -> `test-driven-development` | 这是第一条完整链路，涉及命令、bundle、collector 和错误状态 |
| `07 - define analyze bundle contract` | `test-driven-development` | JSON schema 和文件布局需要先被测试固定 |
| `02 - harden inspector session lifecycle` | `systematic-debugging` + `test-driven-development` | 风险点是误连、误关 inspector 和端口归属 |
| `01 - add stable discover command` | `test-driven-development` | 进程发现输出必须稳定、可解析 |
| `10 - add Codex node process analyze skill` | `skill-creator` | 需要把 CLI 合约转成 repo-local skill，而不是重复实现采集 |

## 5. 第一节：Node 进程和 PID

### 5.1 要学什么

Node.js 服务首先是一个操作系统进程。要做 Node 监控，不能只从 JavaScript 角度看问题，还要理解进程这一层。

本节要掌握：

1. PID 是什么。
2. PPID 是什么。
3. 进程启动命令怎么看。
4. `ps`、`pgrep`、`lsof` 分别解决什么问题。
5. Node 进程和普通进程怎么区分。

### 5.2 后端知识点

| 知识点 | 解释 |
| --- | --- |
| PID | 操作系统给每个进程分配的进程号 |
| PPID | 父进程号，可以判断进程是由 shell、npm、pnpm、node、测试框架还是其他 supervisor 拉起 |
| command line | 进程启动命令，能看到 `node server.js`、`tsx watch`、`vite` 等形态 |
| start time | 进程启动时间，用于判断是否刚刚重启 |
| cpu time | 进程累计消耗 CPU 时间，不等于当前 CPU 使用率 |
| open files | `lsof` 可以看到进程打开的端口、socket、文件 |

### 5.3 本项目对应代码

- `packages/node-cli/src/shared/command.ts`
- `packages/node-cli/src/bin.ts`

当前 `getNodeProcesses()` 主要靠：

```bash
pgrep node
ps -fxp <pid-list>
```

问题是它只识别命令名包含 `node` 的进程，且没有做 inspector 端口检测。

### 5.4 要实现什么

这一节对应未来 `mito-node discover` 的基础能力：

```bash
mito-node discover
mito-node discover --json
mito-node discover --all
```

最小 JSON：

```json
[
  {
    "pid": 12345,
    "ppid": 10000,
    "command": "node demos/listen_server.mjs",
    "startTime": "15:30",
    "cpuTime": "00:00:03",
    "inspector": {
      "enabled": false,
      "port": null
    }
  }
]
```

### 5.5 验收方式

1. 启动一个测试 Node 服务。
2. 执行 `mito-node discover --json`。
3. 能看到目标 PID、PPID、启动命令。
4. 默认不把当前 `mito-node` 自己列为候选。
5. 多个 Node 进程时输出稳定数组，不要求 CLI 自动选择。

### 5.6 对应 PR

- PR: `01 - add stable discover command`
- Branch: `codex/node-monitoring-02-discover`
- Scope:
  - 新增 `discover` 命令。
  - 抽出进程发现模块。
  - 输出文本表格和 JSON。
- 不做：
  - 不开启 inspector。
  - 不采集 memory/report/cpuprofile。
  - 不做 TUI。

### PR status

- PR: local discover command
- Commit: not committed
- Verified command: `pnpm --filter @mitojs/node-cli test`
- Verified command: `pnpm --filter @mitojs/node-cli build`
- Verified command: `node packages/node-cli/dist/cli.mjs discover --json`
- Verified command: `node packages/node-cli/dist/cli.mjs discover`
- Smoke evidence: one plain Node process and one `node --inspect=127.0.0.1:9231` process were both found; the inspected process reported `inspector.enabled=true` and `inspector.port=9231`.
- Smoke evidence: one plain Node process was opened with `SIGUSR1`; `discover --json` detected `inspector.enabled=true` and `inspector.port=9229` through lsof-backed port enumeration plus `/json` probing, even though the command line did not include `--inspect`.
- Remaining gaps: CI-level contract tests and broader cross-platform validation for lsof-backed discover enrichment.
- Superpower flow: `using-superpowers`、`test-driven-development`、`verification-before-completion`.

## 6. 第二节：Inspector 和 CDP

### 6.1 要学什么

Node.js 的 inspector 是调试协议入口。Chrome DevTools、VSCode Debugger 和很多性能工具，本质上都通过 inspector 和目标 Node 进程通信。

本节要掌握：

1. `node --inspect` 是什么。
2. `SIGUSR1` 为什么能打开 Node inspector。
3. `http://127.0.0.1:9229/json` 返回什么。
4. `webSocketDebuggerUrl` 怎么用。
5. Chrome DevTools Protocol 的 `Runtime`、`Profiler` 域分别做什么。

### 6.2 后端知识点

| 知识点 | 解释 |
| --- | --- |
| signal | 操作系统给进程发送的信号，`SIGUSR1` 可触发 Node 开启 inspector |
| TCP port | inspector 默认监听 `9229`，但也可能是自定义端口 |
| HTTP discovery | `/json` 返回可调试 target 列表 |
| WebSocket | CLI 通过 WebSocket 和 inspector 双向通信 |
| CDP | Chrome DevTools Protocol，定义了 `Runtime.evaluate`、`Profiler.start` 等命令 |

### 6.3 本项目对应代码

- `packages/node-cli/src/cli.ts`

当前逻辑：

1. `process.kill(pid, 'SIGUSR1')`
2. 轮询 `127.0.0.1:<port>`
3. 请求 `/json`
4. 连接 `ws://127.0.0.1:<port>/<id>`
5. 发送 inspector 消息
6. 结束时调用 `require('inspector').close()`

当前最大问题是无条件开启、无条件关闭，生命周期不安全。

### 6.4 要实现什么

抽出 `InspectorSessionManager`。

它只做四件事：

1. 检测目标进程是否已有 inspector。
2. 如果没有，再发送 `SIGUSR1`。
3. 连接前验证端口属于目标 PID。
4. 结束时只关闭 CLI 自己开启的 inspector。

建议内部状态：

```ts
interface InspectorSessionState {
  pid: number
  host: '127.0.0.1' | '::1'
  port: number
  openedByCli: boolean
  webSocketDebuggerUrl: string
}
```

### 6.5 验收方式

1. 目标进程未开启 inspector 时，CLI 可以自动开启并连接。
2. 目标进程原本已开启 inspector 时，CLI 直接复用。
3. 目标进程原本已开启 inspector 时，CLI 结束后不能关闭它。
4. 端口被其他 Node 进程占用时，CLI 不应误连。
5. 目标 PID 不存在时，返回清晰错误。

### 6.6 对应 PR

- PR: `02 - harden inspector session lifecycle`
- Branch: `codex/node-monitoring-03-inspector-session`
- Scope:
  - 新增 inspector session 管理模块。
  - 替换 `cli.ts` 里的直接 `SIGUSR1 + 9229` 假设。
  - 为 analyze 链路提供安全 attach 能力。
- 不做：
  - 不改 TUI。
  - 不引入 Rust Agent。
  - 不做复杂端口扫描，只支持明确 PID 和默认/指定端口。

### PR status

- PR: local inspector lifecycle hardening
- Commit: not committed
- Verified command: `pnpm --filter @mitojs/node-cli test`
- Verified command: `pnpm --filter @mitojs/node-cli build`
- Verified command: normal Node process analyzed through `node packages/node-cli/dist/cli.mjs analyze --pid <pid> --duration 50 --json`; `9229` was closed after collection.
- Verified command: pre-inspected Node process analyzed through `node packages/node-cli/dist/cli.mjs analyze --pid <pid> --port 9230 --duration 50 --json`; `9230` remained open after collection.
- Verified command: wrong-port smoke with process A owning `9232` and process B passed to `--pid`; `analyze --pid <B> --port 9232 --json` returned `failed`, exit code `1`, and did not connect to process A.
- Bundle example: `.mito-node/bundles/81572-2026-06-10T18-05-54-231Z` and `.mito-node/bundles/82340-2026-06-10T18-06-07-665Z` generated during verification; removed from worktree after verification.
- Remaining gaps: CI-level contract tests and broader cross-platform validation for lsof-backed inspector discovery.
- Superpower flow: `using-superpowers`、`test-driven-development`、`verification-before-completion`.

## 7. 第三节：Runtime.evaluate 和远程采集

### 7.1 要学什么

很多 Node 进程诊断数据，目标进程自己能提供，但 CLI 不在目标进程里。解决办法就是通过 inspector 的 `Runtime.evaluate` 在目标进程上下文执行一小段安全代码，把结果返回给 CLI。

本节要掌握：

1. CLI 进程和目标 Node 进程不是同一个进程。
2. `Runtime.evaluate` 是在目标进程里执行表达式。
3. 返回值必须可序列化。
4. 远程执行要控制边界，不能把任意用户代码混进稳定合约。

### 7.2 后端知识点

| 知识点 | 解释 |
| --- | --- |
| process boundary | CLI 和目标服务隔离，内存不共享 |
| serialization | inspector 返回的数据需要 JSON 化 |
| privilege | CLI 对目标进程有调试权限时，能力很强，要谨慎 |
| timeout | 远程执行不能无限等待 |

### 7.3 本项目对应代码

- `packages/node-cli/src/cli.ts`
- `packages/node-cli/src/helper.ts`

当前已有 `evaluate()` 和 `FUNCTION_WRAPPER()`，可以复用思想，但需要从“大 CLI 类”里拆出可被 analyze 使用的小函数。

### 7.4 要实现什么

为采集器提供一个稳定内部方法：

```ts
interface InspectorClient {
  evaluate<T>(expression: string, timeoutMs?: number): Promise<T>
  send<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  close(): Promise<void>
}
```

注意：这不是公开 API，只是 CLI 内部模块边界。

### 7.5 验收方式

1. 能通过 `Runtime.evaluate` 获取 `process.pid`。
2. 能通过 `Runtime.evaluate` 获取 `process.memoryUsage()`。
3. 执行失败时返回结构化错误，而不是直接 `process.exit(0)`。
4. 所有超时都有错误信息。

### 7.6 对应 PR

- PR: `03 - introduce inspector client for collectors`
- Branch: `codex/node-monitoring-03-inspector-client`
- Scope:
  - 抽出 inspector client。
  - 统一 request id、响应匹配、超时、错误处理。
- 不做：
  - 不改公开命令。
  - 不实现所有采集器。

## 8. 第四节：Memory 采集

### 8.1 要学什么

内存问题是 Node 服务最常见的线上问题之一。第一阶段不直接做 heap snapshot，因为文件大、耗时长、影响更重。先做轻量 memory summary。

本节要掌握：

1. `process.memoryUsage()` 每个字段代表什么。
2. RSS 和 V8 heap 的区别。
3. `heapUsed` 增长不一定等于泄漏。
4. `external` 和 `arrayBuffers` 常见于 Buffer、原生扩展、网络 IO。
5. 单点采集只能说明当前状态，不能直接证明趋势。

### 8.2 后端知识点

| 字段 | 含义 | 常见解读 |
| --- | --- | --- |
| `rss` | 进程常驻内存 | 操作系统看到的 Node 进程整体占用 |
| `heapTotal` | V8 已分配堆大小 | V8 给 JS 堆准备的空间 |
| `heapUsed` | JS 对象实际使用堆 | 业务对象、闭包、缓存等主要在这里 |
| `external` | V8 外部内存 | Buffer、C++ addon 等 |
| `arrayBuffers` | ArrayBuffer/Buffer 内存 | 大量 Buffer 场景要重点看 |

### 8.3 本项目对应代码

- `packages/node-cli/src/cli.ts` 的 `getMemoryInfo()`
- `packages/node/src/collector/memory.ts`
- `packages/node/src/subjects/memory.ts`

CLI 里当前只打印 `process.memoryUsage()`，没有写入 bundle。

### 8.4 要实现什么

`mito-node analyze` 中的 memory collector 要写：

```text
memory.json
```

建议结构：

```json
{
  "pid": 12345,
  "collectedAt": "2026-06-02T07:30:00.000Z",
  "memoryUsage": {
    "rss": 123,
    "heapTotal": 123,
    "heapUsed": 123,
    "external": 123,
    "arrayBuffers": 123
  },
  "heapStatistics": {
    "total_heap_size": 123,
    "used_heap_size": 123,
    "heap_size_limit": 123
  },
  "resourceUsage": {
    "userCPUTime": 123,
    "systemCPUTime": 123,
    "maxRSS": 123
  }
}
```

数据来源：

1. `process.memoryUsage()`
2. `process.resourceUsage()`
3. `require('v8').getHeapStatistics()`
4. `require('v8').getHeapSpaceStatistics()`

### 8.5 验收方式

1. `analyze --pid <pid> --memory on --json` 能生成 `memory.json`。
2. `memory.json` 是合法 JSON。
3. `summary.json` 能记录 memory artifact 状态。
4. memory 采集失败时，整体可以是 `partial`，而不是直接失败。

### 8.6 对应 PR

- PR: `04 - collect memory artifact in analyze`
- Branch: `codex/node-monitoring-04-memory`
- Scope:
  - 新增 memory collector。
  - 写入 bundle。
  - 在 summary 里记录成功/失败。
- 不做：
  - 不做 heap snapshot。
  - 不判断内存泄漏结论，只输出事实和轻量提示。

## 9. 第五节：Process Report

### 9.1 要学什么

`process.report` 是 Node 自带的诊断报告能力。它能一次性输出进程、Node 版本、平台、libuv、资源限制、JavaScript 栈、原生栈等信息。

本节要掌握：

1. process report 适合做“现场快照”。
2. report 不是 CPU profile，也不是 heap snapshot。
3. report 能帮助判断 Node 版本、启动参数、资源限制、环境变量等。
4. report 可能包含敏感信息，bundle 默认只落本地，不上传。

### 9.2 后端知识点

| 信息 | 用途 |
| --- | --- |
| Node.js version | 判断 API 支持、V8 版本、已知问题 |
| command line | 判断启动参数、是否开启 inspector、内存限制 |
| resource limits | 判断文件句柄、栈、进程资源限制 |
| libuv handles | 判断是否有 timer、socket、server 等活跃句柄 |
| environment | 可能帮助定位环境问题，但也可能有敏感信息 |

### 9.3 本项目对应代码

- `packages/node-cli/src/cli.ts` 的 `getProcessReport()`

当前实现是远程调用 `process.report.writeReport(filename)`，再走 `upload()`。首版应该改为只写本地 bundle。

### 9.4 要实现什么

在目标进程内执行：

```js
process.report.getReport()
```

然后由 CLI 写成本地文件：

```text
process.report.json
```

优先用 `getReport()`，因为它直接返回对象，CLI 可控性更高。只有必要时再考虑 `writeReport()`。

### 9.5 验收方式

1. `process.report.json` 能生成。
2. 文件里能看到 `header`、`javascriptStack`、`resourceUsage` 等主要字段。
3. report 不可用时，analyze 输出 `partial`。
4. `warnings` 说明 report 缺失原因。

### 9.6 对应 PR

- PR: `05 - collect process report artifact`
- Branch: `codex/node-monitoring-05-report`
- Scope:
  - 新增 report collector。
  - 写入 `process.report.json`。
  - 在 summary 里记录 artifact 状态。
- 不做：
  - 不上传报告。
  - 不对环境变量做复杂脱敏，首版只本地保存并在文档中提示敏感性。

## 10. 第六节：CPU Profile

### 10.1 要学什么

CPU profile 是分析 Node 进程“CPU 时间花在哪里”的核心数据。它不是实时 CPU 百分比，而是一段时间内的采样调用栈。

本节要掌握：

1. CPU profile 是采样，不是每次函数调用都记录。
2. `Profiler.start` 和 `Profiler.stop` 之间的时间窗口就是采集窗口。
3. 高 CPU 问题通常要结合压测或复现场景。
4. `.cpuprofile` 可以被 Chrome DevTools 打开。

### 10.2 后端知识点

| 概念 | 解释 |
| --- | --- |
| sampling profiler | 周期性采样调用栈，统计函数耗时分布 |
| wall time | 现实时间窗口，比如 10 秒 |
| CPU time | 进程实际消耗 CPU 的时间 |
| hot path | profile 中耗时最高的调用路径 |
| flame chart | 用图形展示调用栈和耗时 |

### 10.3 本项目对应代码

- `packages/node-cli/src/cli.ts` 的 `getCPUProfile()`

当前实现已经使用：

```text
Profiler.enable
Profiler.start
Profiler.stop
Profiler.disable
```

但它没有写入稳定 bundle，也没有把失败状态结构化。

### 10.4 要实现什么

`mito-node analyze` 中的 CPU collector：

```bash
mito-node analyze --pid 12345 --duration 10000 --cpu-profile on --json
```

输出：

```text
cpu.cpuprofile
```

采集失败时：

1. 停止 profiler。
2. 尝试 disable profiler。
3. 记录 artifact 状态为 `failed`。
4. 如果 memory/report 成功，整体状态是 `partial`。

### 10.5 验收方式

1. 能生成 `cpu.cpuprofile`。
2. Chrome DevTools 可以打开该文件。
3. `duration` 参数生效。
4. CPU profile 失败时不影响 memory/report 已生成文件。
5. 目标进程采集中退出时能返回清晰错误。

### 10.6 对应 PR

- PR: `06 - collect cpu profile artifact`
- Branch: `codex/node-monitoring-06-cpu-profile`
- Scope:
  - 新增 CPU profile collector。
  - 写入 `cpu.cpuprofile`。
  - 支持 `--duration`。
- 不做：
  - 不实现实时 CPU 曲线。
  - 不把 `monitor-cpu` 纳入稳定接口。

## 11. 第七节：Bundle 和 JSON 合约

### 11.1 要学什么

Agent 不应该靠读日志猜结果。一个稳定 CLI 要明确告诉调用方：bundle 在哪里、哪些文件生成了、哪些采集失败了、下一步该读哪个文件。

这些信息不是 Node.js 自动提供的，而是 CLI 自己在编排采集时记录的“采集账本”。

### 11.2 后端知识点

| 问题 | 来源 |
| --- | --- |
| bundle 在哪里 | CLI 自己创建目录时记录 |
| 哪些文件生成了 | CLI 写文件成功后记录 |
| 哪些采集失败了 | CLI 对每个 collector 包 try/catch 后记录 |
| 下一步读哪个文件 | CLI 根据 artifact 状态生成 readOrder |
| 整体是 success 还是 partial | CLI 根据成功 artifact 数量计算 |

### 11.3 文件布局

固定 bundle 文件名：

```text
bundleDir/
  manifest.json
  summary.json
  summary.md
  memory.json
  process.report.json
  cpu.cpuprofile
```

建议默认 bundle 目录：

```text
<out-dir>/mito-node/<pid>-<timestamp>/
```

如果用户没有传 `--out-dir`，默认使用：

```text
./.mito-node/bundles/
```

这样比直接写 `/tmp` 更方便在项目里复盘，也便于 Agent 读取。

### 11.4 稳定 JSON 输出

`--json` 输出固定对象：

```ts
interface AnalyzeResult {
  status: 'success' | 'partial' | 'failed'
  pid: number
  bundleDir: string
  artifacts: {
    manifest: ArtifactStatus
    summaryJson: ArtifactStatus
    summaryMd: ArtifactStatus
    memory: ArtifactStatus
    report: ArtifactStatus
    cpuProfile: ArtifactStatus
  }
  readOrder: Array<'summaryMd' | 'summaryJson' | 'memory' | 'report' | 'cpuProfile'>
  warnings: string[]
  errors: string[]
}

interface ArtifactStatus {
  path: string
  status: 'ok' | 'skipped' | 'failed'
  error?: string
}
```

### 11.5 状态计算

建议规则：

| 状态 | 规则 | 退出码 |
| --- | --- | --- |
| `success` | memory、report、cpuProfile 按启用项全部成功 | `0` |
| `partial` | 至少一个核心 artifact 成功，但有采集失败 | `0` |
| `failed` | 没有任何可用核心 artifact | `1` |

### 11.6 `summary.md` 写什么

`summary.md` 是给人和 Agent 第一眼看的文件。

建议结构：

```markdown
# mito-node analysis summary

## Target
- PID: 12345
- Command: node demos/listen_server.mjs
- Inspector: opened by CLI

## Artifacts
- memory: ok
- report: ok
- cpuProfile: ok

## Quick signals
- rss: 120 MB
- heapUsed: 30 MB
- cpuProfile duration: 10000 ms

## Suggested read order
1. summary.json
2. memory.json
3. process.report.json
4. cpu.cpuprofile

## Warnings
- none
```

### 11.7 对应 PR

- PR: `07 - define analyze bundle contract`
- Branch: `codex/node-monitoring-06-bundle-contract`
- Scope:
  - 定义 bundle writer。
  - 定义 analyze result schema。
  - 生成 `manifest.json`、`summary.json`、`summary.md`。
  - 固定退出码语义。
- 不做：
  - 不写复杂诊断结论。
  - 不把所有原始数据塞进 stdout。

## 12. 第八节：`mito-node analyze` 第一刀

这一节是最重要的第一刀。它不是最终形态，但要让整个方向落地。

### 12.1 第一刀到底做什么

第一刀只做：

```bash
mito-node analyze --pid <pid> --json
```

内部流程：

```text
parse args
  |
  v
validate pid
  |
  v
create bundle dir
  |
  v
attach inspector
  |
  v
collect memory/report/cpuprofile
  |
  v
write manifest/summary/artifacts
  |
  v
print JSON result
```

### 12.2 为什么先做 analyze，不先做 discover

`discover` 解决“找谁”的问题，`analyze` 解决“能不能分析”的问题。

第一刀最应该证明的是：

1. CLI 能连接一个指定 PID。
2. CLI 能采集真实 Node 数据。
3. CLI 能生成稳定 bundle。
4. Agent 能通过 JSON 找到产物。

只要用户手工给 PID，这条链路就可以先跑通。`discover` 可以下一节补。

### 12.3 最小命令参数

第一刀参数建议只收敛这些：

```bash
mito-node analyze \
  --pid <pid> \
  [--port <port>] \
  [--out-dir <dir>] \
  [--duration <ms>] \
  [--json]
```

默认值：

| 参数 | 默认值 |
| --- | --- |
| `--port` | `9229` |
| `--out-dir` | `./.mito-node/bundles` |
| `--duration` | `10000` |
| `--json` | false |

第一刀先不加 `--memory on|off`、`--report on|off`、`--cpu-profile on|off`，避免参数过多。默认三项都采集，后续 PR 再补开关。

### 12.4 建议代码结构

首版不要上重抽象，但要避免继续把所有东西塞进 `cli.ts`。

建议新增：

```text
packages/node-cli/src/analyze/
  analyze.ts
  bundle.ts
  collectors.ts
  types.ts

packages/node-cli/src/inspector/
  client.ts
  session.ts
```

职责：

| 文件 | 职责 |
| --- | --- |
| `analyze.ts` | 编排 analyze 主流程 |
| `bundle.ts` | 创建目录、写文件、记录 artifact 状态 |
| `collectors.ts` | memory/report/cpuprofile 三个 collector |
| `types.ts` | AnalyzeResult、ArtifactStatus 等类型 |
| `client.ts` | WebSocket request/response、Runtime.evaluate、Profiler 命令 |
| `session.ts` | inspector 开启、连接、关闭生命周期 |

### 12.5 第一刀实现顺序

1. 在 `bin.ts` 增加 `analyze` 命令。
2. 先不接真实采集，生成空 bundle 和 JSON。
3. 接入 PID 校验。
4. 接入 inspector session。
5. 接入 memory collector。
6. 接入 report collector。
7. 接入 CPU profile collector。
8. 生成 `summary.json` 和 `summary.md`。
9. 修正退出码。
10. 补手工验证脚本和文档。

### 12.6 第一刀验收

准备一个测试进程：

```bash
node demos/listen_server.mjs
```

执行：

```bash
mito-node analyze --pid <pid> --duration 3000 --json
```

期望：

1. stdout 是一个合法 JSON 对象。
2. JSON 里有 `bundleDir`。
3. bundle 目录真实存在。
4. 至少生成 `manifest.json`、`summary.json`、`summary.md`。
5. 如果 memory/report/cpuprofile 都成功，状态是 `success`。
6. 如果其中一个失败，但至少一个成功，状态是 `partial`。
7. 如果全部失败，状态是 `failed`，退出码是 `1`。

### 12.7 对应 PR

- PR: `08 - implement first analyze command`
- Branch: `codex/node-monitoring-01-analyze-first-cut`
- Scope:
  - 增加 `mito-node analyze`。
  - 输出 JSON。
  - 写本地 bundle。
  - 采集 memory/report/cpuprofile。
- 不做：
  - 不做 `discover`。
  - 不做 Codex Skill。
  - 不做 Claude Code command。
  - 不接 Rust Agent。
  - 不改 TUI。

### PR status

- PR: local first cut
- Commit: not committed
- Verified command: `pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand src/__test__/analyze/bundle.spec.ts src/__test__/analyze/command.spec.ts src/__test__/analyze/collectors.spec.ts src/__test__/analyze/analyze.spec.ts src/__test__/inspector/client.spec.ts src/__test__/inspector/session.spec.ts`
- Verified command: `pnpm --filter @mitojs/node-cli build`
- Verified command: `node packages/node-cli/dist/cli.mjs analyze --pid 41201 --duration 100 --json`
- Bundle example: `.mito-node/bundles/41201-2026-06-10T17-58-26-111Z` generated with `manifest.json`、`summary.json`、`summary.md`、`memory.json`、`process.report.json`、`cpu.cpuprofile`; removed from worktree after verification.
- Remaining gaps: CI-level contract tests.
- Superpower flow: `using-superpowers`、`writing-plans`、`test-driven-development`、`verification-before-completion`.

## 13. 第九节：人用 TUI，Agent 用快捷参数

### 13.1 这句话怎么理解

这个 CLI 有两种使用方式。

第一种是人用：

```bash
mito-node
```

或者：

```bash
mito-node tui
```

人更适合看到菜单、进程列表、实时曲线、下一步提示。例如：

1. 选择一个 Node 进程。
2. 选择要看 memory 还是 CPU。
3. 看到实时变化。
4. 按提示生成报告或 profile。

第二种是 Agent 用：

```bash
mito-node analyze --pid 12345 --json
```

Agent 不需要菜单，也不需要颜色和交互。Agent 需要：

1. 命令一次执行完。
2. stdout 是稳定 JSON。
3. 产物落在本地。
4. 失败原因可解析。
5. 下一步读哪个文件写清楚。

### 13.2 两种模式不要混在一起

| 能力 | 人用 TUI | Agent 快捷参数 |
| --- | --- | --- |
| 输出 | 表格、颜色、图形、菜单 | JSON |
| 交互 | 可以多步选择 | 必须非交互 |
| 错误 | 可以提示用户重试 | 必须机器可读 |
| 产物 | 可以提示打开文件 | 必须返回路径 |
| 稳定性 | UI 可以迭代 | JSON 合约必须稳定 |

### 13.3 对应 PR

- PR: `09 - separate human tui and agent mode docs`
- Branch: `codex/node-monitoring-07-agent-json`
- Scope:
  - 明确 `--json` 模式不输出 debug log。
  - 清理当前 `bin.ts` 里的调试 `console.log`。
  - 文档化 TUI 和 Agent 模式边界。
- 不做：
  - 不要求 TUI 完整产品化。
  - 不把 TUI 输出作为 Agent 输入。

## 14. 第十节：Codex Skill 适配

### 14.1 要学什么

Skill 的本质不是采集器，而是给 Codex 一套稳定工作流。真正采集仍然由 `mito-node` 完成。

Codex Skill 要告诉 Codex：

1. 什么时候触发。
2. 如何选择 PID。
3. 如何调用 `mito-node analyze`。
4. 如何读取 bundle。
5. 输出诊断时哪些话不能乱说。

### 14.2 建议目录

repo-local skill：

```text
.agents/skills/node-process-analyze/
  SKILL.md
  references/
    output-schema.md
```

### 14.3 Skill 工作流

1. 用户给了 PID：
   ```bash
   mito-node analyze --pid <pid> --json
   ```
2. 用户没给 PID：
   ```bash
   mito-node discover --json
   ```
3. 只发现一个候选进程，自动选中。
4. 发现多个候选进程，让用户选择 PID。
5. 读取 analyze JSON。
6. 按 `readOrder` 读取 bundle。
7. 输出诊断，明确区分 `success`、`partial`、`failed`。

### 14.4 Skill 输出原则

Codex 输出诊断时要遵循：

1. 只基于真实生成的文件。
2. 缺失 artifact 时不能脑补。
3. `partial` 要明确说明哪些数据缺失。
4. CPU profile 如果没读，就不要下 CPU 热点结论。
5. memory 单点数据不能直接断言泄漏，只能提示风险和下一步采样建议。

### 14.5 对应 PR

- PR: `10 - add Codex node process analyze skill`
- Branch: `codex/node-monitoring-08-codex-skill`
- Scope:
  - 新增 repo-local skill。
  - 补 output schema reference。
  - 写明失败处理。
- 不做：
  - Skill 不实现采集。
  - Skill 不绕过 CLI 直接连 inspector。

## 15. 第十一节：Claude Code 适配

### 15.1 适配思路

Claude Code 也不应该自己实现采集。它和 Codex 一样，只需要能执行命令、读取本地文件，就可以复用 `mito-node`。

适配层有两种方式：

1. Claude Skill：放在 `.claude/skills/<skill-name>/SKILL.md`。
2. Slash command：放在 `.claude/commands/*.md`，通过 `/xxx` 触发。

当前官方文档显示，Claude Code 支持自定义 slash commands，也支持基于 `SKILL.md` 的 skills。后续具体目录以 Claude Code 当前版本文档为准。

### 15.2 建议首版

首版优先做 skill，而不是命令。

```text
.claude/skills/node-process-analyze/
  SKILL.md
  references/
    output-schema.md
```

如果团队更习惯 slash command，再补：

```text
.claude/commands/node-analyze.md
```

用户使用方式类似：

```text
/node-analyze 12345
```

命令文件内部只写工作流：

```text
Run `mito-node analyze --pid $ARGUMENTS --json`.
Read the returned bundle.
Summarize findings based only on generated artifacts.
```

### 15.3 和 Codex Skill 的关系

Codex 和 Claude Code 不要各自维护两套诊断逻辑。建议把共同规则放在：

```text
docs/solutions/node-process-analysis-plan.md
docs/solutions/node-monitoring-handbook.md
```

然后两个适配层只保留平台相关的触发和调用方式。

### 15.4 对应 PR

- PR: `11 - add Claude Code node process analyze adapter`
- Branch: `codex/node-monitoring-09-claude-code`
- Scope:
  - 新增 `.claude/skills/node-process-analyze/SKILL.md`。
  - 可选新增 `.claude/commands/node-analyze.md`。
  - 复用同一套 CLI JSON 和 bundle schema。
- 不做：
  - 不做 Claude 专有采集逻辑。
  - 不把 Claude command 写成唯一入口。

## 16. 第十二节：NodeAgent 第一版

### 16.1 为什么后续还是要做 Agent

CLI 适合一次性诊断，但它解决不了长期监控。

典型长期问题：

1. 内存是慢慢涨的，不是某一秒突然能看出来。
2. CPU 峰值可能已经过去，手动 analyze 时现场已经没了。
3. 线上服务需要持续采样、缓存、查询和告警。
4. 需要在多个进程之间做统一管理。

所以后续还是要做 NodeAgent。

### 16.2 NodeAgent 应该解决什么

NodeAgent 首版只做四件事：

1. 进程注册：知道当前有哪些被 SDK 接入的 Node 服务。
2. 指标接收：接收 CPU、memory、error、timeout 等数据。
3. 本地缓存：保存最近一段时间的数据。
4. 动作下发：允许 CLI 请求某个进程做一次诊断。

### 16.3 当前仓库基础

| 模块 | 当前状态 |
| --- | --- |
| `packages/node/src/client.ts` | 能启动 Rust Agent 和 proxy thread，但 subject 初始化基本没启用 |
| `packages/node/src/collector/*` | 有 CPU、memory、JS error、timeout collector |
| `packages/node/src/subjects/*` | 有 RxJS subject 模式 |
| `packages/node/src/shared/http.ts` | HTTP proxy 仍是 stub |
| `agent/src/data_processor/store.rs` | 有 store 雏形 |
| `agent/src/data_processor/subscribe.rs` | 订阅和动作处理还没完成 |

### 16.4 NodeAgent 第一版数据流

```text
Business Node Process
  |
  | @mitojs/node SDK
  v
Collector -> Subject
  |
  | HTTP / UDS / IPC
  v
NodeAgent / Rust Agent
  |
  v
Local Store
  |
  v
mito-node agent status/query/analyze
```

### 16.5 不要一开始做太大

NodeAgent 第一版不要做：

1. 不做分布式。
2. 不做云端上传。
3. 不做复杂 UI。
4. 不做持久化数据库。
5. 不做告警系统。

先做本地单机闭环：

1. SDK 能发数据。
2. Agent 能收数据。
3. CLI 能查数据。
4. CLI 能触发一次 analyze。

### 16.6 对应 PR

- PR: `12 - define NodeAgent MVP contract`
- Branch: `codex/node-monitoring-10-node-agent`
- Scope:
  - 定义 NodeAgent MVP 接口。
  - 文档化 SDK -> Agent -> CLI 数据流。
  - 明确当前 Rust Agent 缺口。
- 不做：
  - 不一次性重写 Rust Agent。
  - 不把 NodeAgent 作为 `analyze` 第一刀依赖。

### PR status

- PR: local NodeAgent MVP store and HTTP contract
- Commit: not committed
- Agent endpoints:
  - `GET /processes`: 返回 Agent 当前缓存的进程列表。
  - `POST /processes/register`: 注册或刷新一个进程，body 为 `{ "process_id": 424242, "proxy_port": 16667 }`；Agent 仍兼容旧的 `uds_port` 字段。
  - `POST /metrics`: 写入进程最近指标，body 为 `{ "process_id": 424242, "metric_type": "memory", "data": { "rss": 100 } }`。
- Store contract:
  - `Store::register_process(process_id, proxy_port, now)` 记录进程、本地 proxy worker 端口和最新心跳时间。
  - `Store::record_metric(process_id, metric_type, data, now)` upsert 进程并保留最近指标快照。
  - `Store::list_processes()` 按 PID 稳定排序返回进程状态。
- Verified command: `~/.cargo/bin/cargo test`
- Verified command: `~/.cargo/bin/cargo build`
- Smoke evidence: started `target/debug/mitojs-agent` on `127.0.0.1:16676`, posted `/processes/register` and `/metrics`, then `GET /processes` returned process `424242` with `proxy_port=16667` and memory metric `{ "rss": 100 }`.
- Remaining gaps: `metrics --pid` still reads latest snapshots rather than a historical metrics endpoint; Rust build still emits pre-existing unused/dead-code warnings.
- Superpower flow: `using-superpowers`、`test-driven-development`、`verification-before-completion`.

## 17. 第十三节：SDK 到 Agent 的指标链路

### 17.1 要学什么

长期监控不是 CLI 连过去拉一次，而是业务进程主动或半主动地持续产出指标。

本节要掌握：

1. collector 模式。
2. subject / observable 模式。
3. 采样间隔。
4. backpressure。
5. IPC 和 HTTP proxy。

### 17.2 本项目对应代码

- `packages/node/src/collector/base.ts`
- `packages/node/src/collector/cpu.ts`
- `packages/node/src/collector/js-error.ts`
- `packages/node/src/collector/memory.ts`
- `packages/node/src/collector/timeout.ts`
- `packages/node/src/subjects/base.ts`
- `packages/node/src/subjects/cpu.ts`
- `packages/node/src/subjects/js-error.ts`
- `packages/node/src/subjects/memory.ts`
- `packages/node/src/subjects/timeout.ts`
- `packages/node/src/client.ts`
- `packages/node/src/proxy_thread/index.ts`

### 17.3 最小实现目标

把 SDK 指标链路跑通：

```text
collector -> subject -> proxy thread -> agent endpoint -> store
```

首版先接 memory、CPU、JS error 和 timeout，全部进入 Agent 的 latest metrics snapshot。

### 17.4 对应 PR

- PR: `13 - connect SDK collectors to local agent`
- Branch: `codex/node-monitoring-11-sdk-agent-pipeline`
- Scope:
  - 启用 memory、CPU、JS error 和 timeout subject。
  - 将采集数据发送到本地 Agent。
  - Agent store 能看到最近 N 条数据。
- 不做：
  - 不做远程服务。
  - 不做历史时间窗口查询。

### 17.5 当前状态

- PR: local SDK collector to Agent pipeline
- Code:
  - `packages/node/src/agent.ts`: 将 `SubjectNames.CPU/Memory/JSError/Timeout` 映射为 Rust Agent 支持的 `cpu/memory/js_error/timeout` metric type，并发送当前 PID 的 metric payload；`Error` 和 `Map` 会转成 JSON-safe payload。
  - `packages/node/src/request.ts`: 对齐 Agent HTTP contract：`POST /processes/register` 和 `POST /metrics`。
  - `packages/node/src/init.ts`: `SyncToAgent` 注册当前进程，并使用 proxy worker 实际监听端口。
  - `packages/node/src/proxy_thread/index.ts`: proxy worker 启动后回传真实端口。
  - `packages/node/src/client.ts`: `MitoNode.start()` 启动 Agent、proxy worker、进程注册和 CPU/Memory/JSError/Timeout subjects；`destroy()` 停止 subject、proxy worker 和 Agent。
  - `packages/node/src/subjects/js-error.ts`: 将 collector 捕获到的 process error 事件桥接到 subject stream。
  - `packages/node/src/subjects/timeout.ts`: 增加 timeout subject，周期性上报当前 setTimeout/setInterval 存活记录。
  - `packages/node/tsconfig.json`: SDK 构建回到 CommonJS，避免 dist 运行时 extensionless ESM import 解析失败。
- Verified command: `pnpm --filter @mitojs/node exec jest --config jest.config.cjs --runInBand`
- Verified command: `pnpm --filter @mitojs/node build`
- Verified command: `~/.cargo/bin/cargo test`
- Smoke evidence: ran built `packages/node/dist/client.js` with `MITO_AGENT_TCP_PORT=16679`; SDK started packaged Rust Agent, registered process `70953` with `proxy_port=16667`, emitted `cpu`、`memory`、`js_error`、`timeout`, and `node packages/node-cli/dist/cli.mjs agent metrics --pid 70953 --host localhost --port 16679 --json` returned `metric_status=success` with no missing metric types.
- Remaining gaps: only the current darwin-arm64 packaged Agent binary was rebuilt by local `build:rust`; timeout payload currently reports active timer records, not leak classification.

## 18. 第十四节：CLI 查询 NodeAgent

### 18.1 要学什么

一旦有了长期 Agent，CLI 就不只是 `analyze --pid`，还应该能查询 Agent 中缓存的状态。

### 18.2 建议命令

```bash
mito-node agent status --json
mito-node agent processes --json
mito-node agent metrics --pid 12345 --json
```

`--last 60s` 暂时不做。当前 Rust store 只保留 latest snapshots，尚未定义按时间窗口查询的存储和过滤语义。

### 18.3 最小输出

```json
{
  "agent": {
    "name": "mitojs-agent",
    "version": "0.1.0",
    "status": "running"
  },
  "processes": [
    {
      "process_id": 12345,
      "proxy_port": 16667,
      "latest_heartbeat_time": 1781116112,
      "latest_metrics": [
        {
          "metric_type": "memory",
          "data": {
            "rss": 100
          },
          "recorded_at": 1781116112
        }
      ]
    }
  ]
}
```

### 18.4 对应 PR

- PR: `14 - add CLI agent query commands`
- Branch: `codex/node-monitoring-12-agent-query`
- Scope:
  - 增加 agent status/processes/metrics 命令。
  - 只查本地 Agent。
- 不做：
  - 不做远程 Agent。
  - 不做 UI 展示。
  - 不做 `--last` 时间窗口查询。

### 18.5 当前状态

- PR: local CLI agent query commands
- Code:
  - `packages/node-cli/src/agent/client.ts`: 查询 `GET /info` 和 `GET /processes`，并校验 Agent 返回结构。
  - `packages/node-cli/src/agent/agent.ts`: 实现 `status`、`processes`、`metrics --pid` 三个查询动作。
  - `packages/node-cli/src/agent/format.ts`: 提供 human-readable 输出；`--json` 直接输出结构化结果。
  - `packages/node-cli/src/bin.ts`: 挂载 `mito-node agent status/processes/metrics`。
- Verified command: `pnpm --filter @mitojs/node-cli exec jest --config jest.config.cjs --runInBand`
- Verified command: `pnpm --filter @mitojs/node-cli build`
- Smoke evidence: started `agent/target/debug/mitojs-agent` on `127.0.0.1:16677`, posted `/processes/register` and `/metrics`, then verified:
  - `node packages/node-cli/dist/cli.mjs agent status --host 127.0.0.1 --port 16677 --json`
  - `node packages/node-cli/dist/cli.mjs agent processes --host 127.0.0.1 --port 16677 --json`
  - `node packages/node-cli/dist/cli.mjs agent metrics --pid 424242 --host 127.0.0.1 --port 16677 --json`
- Remaining gaps: `metrics --pid` reads latest snapshots from `/processes` rather than a dedicated historical metrics endpoint; no `--last` time-window query yet.

## 19. 第十五节：测试和构建稳定性

### 19.1 要学什么

可用的 CLI 不能只靠手工跑通。尤其是给 Agent 使用时，JSON 合约一旦变动，上层 skill 和 Claude Code command 都会坏。

### 19.2 当前问题

当前已知问题：

1. 之前本地验证过旧构建链路存在 Rollup 多 chunk 和 `output.file` 冲突。
2. 现在仓库已出现 `packages/node-cli/vite.config.ts`，上周打包方向已经调整到 Vite/Rolldown。
3. Jest 在当前环境可能被 Watchman 权限问题影响。

### 19.3 需要补的测试

| 类型 | 测什么 |
| --- | --- |
| unit test | bundle writer、status 计算、schema 输出 |
| integration test | 启动 demo Node 进程后运行 analyze |
| contract test | `--json` 输出字段不漂移 |
| error test | PID 不存在、非 Node PID、端口不可连 |
| build test | `pnpm --filter @mitojs/node-cli build` |

### 19.4 对应 PR

- PR: `15 - add CLI contract tests and build gates`
- Branch: `codex/node-monitoring-13-test-build`
- Scope:
  - 为 analyze JSON 加 contract test。
  - 为 bundle writer 加 unit test。
  - 固定 Jest watchman 配置或提供稳定运行方式。
- 不做：
  - 不要求 Rust Agent 测试在第一阶段全部通过。

## 20. 第十六节：飞书规划对齐后的 P0/P1/P2

飞书文档把项目拆成了几个优先级：命令行工具是 P0，Subject 订阅是 P0，线上分析是 P2。结合当前仓库和本小册，建议重新整理成下面的优先级。

### 20.1 P0：先做能独立成立的诊断闭环

P0 要解决的是“用户现在能不能用起来，Agent 能不能稳定调用”。

| P0 项 | 为什么是 P0 | 对应能力 |
| --- | --- | --- |
| `mito-node analyze --pid --json` | 没有它，Agent 和脚本没有稳定入口 | 一次性诊断 |
| bundle + JSON 合约 | 没有它，调用方不知道文件在哪、哪些失败 | 产物索引 |
| inspector 生命周期 | 不安全会误连或关闭用户 inspector | 调试安全 |
| memory/report/cpuprofile | 这是首版最有价值的三类诊断产物 | 采集核心 |
| `mito-node discover --json` | 多进程场景下需要稳定选目标 | 进程发现 |
| Subject 单功能接入 | 用户只想 import 某个监控能力时不能强制接全套 SDK | SDK 可用性 |

P0 不要求把 Rust Agent 做成完整产品，但要定义清楚未来接入边界。

### 20.2 P1：提升实际可用性

P1 解决的是“能不能更像一个真实工具，而不是 demo”。

| P1 项 | 目标 |
| --- | --- |
| TUI/top-like 界面 | 给人使用，实时看进程、memory、CPU、日志 |
| `.log` 实时输出 | SDK 接入后可 `tail -f` 看最新指标 |
| CLI 参数校验 | Commander 14 已要求 Node.js v20+，参数错误要清晰 |
| 自动触发诊断 | CPU 高、水位高、fd 高时自动触发 profile/report |
| 竞品对照 | 对比 Clinic.js、PM2，明确自己的差异点 |

### 20.3 P2：长期平台化能力

P2 解决的是“线上平台化和长期诊断”。

| P2 项 | 目标 |
| --- | --- |
| NodeAgent 完整链路 | SDK -> Agent -> store -> CLI 查询 |
| 线上分析页面 | 本地启动可视化页面看进程和线程信息 |
| Action Trace | 结合 `require-in-the-middle` / `import-in-the-middle` 做链路追踪 |
| Continuous Profiling | 持续性能分析，而不是只靠手动触发 |
| 远程调试和定向请求 | 支持指定请求或远程环境里的诊断 |

### 20.4 对应 PR

- PR: `16 - align roadmap with original Feishu planning`
- Branch: `codex/node-monitoring-14-roadmap-align`
- Scope:
  - 把飞书原始规划转成 P0/P1/P2 路线。
  - 明确 CLI、SDK、Agent、TUI、线上分析的先后关系。
  - 给每条路线补 PR 边界。
- 不做：
  - 不在这个 PR 里实现新功能。

## 21. 第十七节：UDS、UDP、TCP 怎么选

飞书文档里已经给过 UDS、UDP、TCP 的对比。结合本项目，建议按通信对象来选，而不是抽象地选一个“最好”的协议。

### 21.1 协议对比

| 特性 | UDS | UDP | TCP |
| --- | --- | --- | --- |
| 性能 | 极高 | 高 | 中 |
| 可靠性 | 高 | 低 | 高 |
| 安全性 | 高 | 低 | 中到高 |
| 跨主机能力 | 无 | 有 | 有 |
| 平台兼容性 | 类 Unix / Win10+ | 全平台 | 全平台 |
| 开发复杂度 | 低 | 低 | 中 |

### 21.2 本项目里的推荐用法

| 通信场景 | 推荐协议 | 原因 |
| --- | --- | --- |
| 业务 Node 进程 -> 本机 Agent | UDS | 同机、高频、低开销、安全性更好 |
| CLI -> 本机 Agent | TCP/HTTP | CLI 查询和控制更容易调试，也方便后续扩展 |
| 外部请求 -> Pod 内部 Agent | TCP/HTTP | 需要跨进程、跨网络或端口转发 |
| 高频 Metrics 数据 | UDS 优先 | UDP 可靠性不足，TCP 成本相对更高 |
| 调试命令下发 | TCP/HTTP 或 UDS | 取决于调用方是否和 Agent 同机 |

### 21.3 当前仓库需要澄清的点

飞书文档里提到“UDS 从监听 path 改为监听 port”，这里概念上需要收敛一下：

1. UDS 本身通常是 socket path，不是 TCP port。
2. 如果要监听 port，那更像 TCP/HTTP。
3. 可以把内部命名统一成 `endpoint`，里面再区分 `udsPath`、`tcpPort`、`httpUrl`。
4. 对外 JSON 不要写死 `port`，除非确实是 TCP port。

建议第一版 Agent 注册结构：

```ts
interface AgentEndpoint {
  type: 'uds' | 'tcp' | 'http'
  udsPath?: string
  port?: number
  url?: string
}
```

### 21.4 对应 PR

- PR: `17 - define agent communication endpoints`
- Branch: `codex/node-monitoring-15-agent-endpoints`
- Scope:
  - 定义 SDK 和 Agent 的 endpoint schema。
  - 区分 UDS path、TCP port、HTTP URL。
  - 更新命名，避免把 UDS 和 port 混用。
- 不做：
  - 不一次性迁移所有通信实现。

## 22. 第十八节：Subject 单功能接入

飞书文档里有一个很重要的诉求：当用户只需要监控中的一个小功能，比如 V8 内存占用时，只要 import 一小块代码。

这意味着 `@mitojs/node` 不应该只有一个重型 `new MitoNode().start()` 入口，还应该支持轻量 Subject。

### 22.1 目标用法

```ts
import { CPUSubject, MemorySubject } from '@mitojs/node'

const memorySubject = new MemorySubject({ duration: 1000 })
memorySubject.subscribe((event) => {
  console.log(event)
})

const cpuSubject = new CPUSubject({ duration: 1000 })
cpuSubject.subscribe((event) => {
  console.log(event)
})
```

### 22.2 指标分类

可以定时触发并捕获的：

| 指标 | 说明 |
| --- | --- |
| CPU | 进程 CPU 使用、用户态/内核态时间 |
| 内存信息 | RSS、heap、external、arrayBuffers |
| Libuv handle/request 个数 | 活跃 handle 和 request 数量 |
| 事件循环利用率 | event loop utilization |
| 文件描述符个数 | fd 数量、fd 类型、fd 负载 |
| timer 存活个数 | setTimeout/setInterval 存活情况 |

只能通过监听回调捕获的：

| 指标 | 触发方式 |
| --- | --- |
| JS Error | `uncaughtExceptionMonitor`、`unhandledRejection` |
| GC 次数和耗时 | `PerformanceObserver` |

### 22.3 和 CLI analyze 的关系

Subject 是长期持续采样，CLI analyze 是一次性现场诊断。

| 能力 | Subject | CLI analyze |
| --- | --- | --- |
| 使用方式 | import 到业务进程 | 外部命令 attach 目标进程 |
| 时间维度 | 持续 | 单次 |
| 数据来源 | SDK collector | inspector / Runtime / Profiler |
| 适合场景 | 趋势、告警、长期指标 | 现场诊断、profile、report |

两者要共享指标概念，但不要共享同一套实现入口。

### 22.4 对应 PR

- PR: `18 - expose standalone monitoring subjects`
- Branch: `codex/node-monitoring-16-subject-entry`
- Scope:
  - 明确 `CPUSubject`、`MemorySubject` 的公开导出。
  - 补轻量使用文档。
  - 为 Subject 补基础单测。
- 不做：
  - 不接完整 Agent。
  - 不做所有指标类型。

## 23. 第十九节：高负载下的采集边界

飞书文档里记录了一个关键验证：当进程 CPU 100% 负载时，启动 inspector 后仍然可以录制 CPU profile 和 heap snapshot，但可能无法获取 memory。

这个结论很重要，它直接影响 analyze 的失败语义。

### 23.1 为什么 CPU profile 可能还能采集

CPU profile 和 heap snapshot 主要由 V8 内部机制触发。通过调试协议下发后，只要主线程还有机会响应调试命令，V8 就可能暂停 JS 执行并采集。

这类操作不等价于让业务 JS 主动执行一段普通函数。

### 23.2 为什么 memory 可能卡住

`process.memoryUsage()` 本质上还是通过 `Runtime.evaluate` 在目标主线程执行 JavaScript 表达式。

如果主线程被 CPU 密集任务长期占满，memory collector 可能：

1. 超时。
2. 迟迟不返回。
3. 目标进程看起来还活着，但 inspector 请求不可用。

### 23.3 对 analyze 合约的影响

所以 `analyze` 不能假设三个 collector 要么都成功，要么都失败。

合理结果是：

```json
{
  "status": "partial",
  "artifacts": {
    "memory": {
      "status": "failed",
      "error": "Runtime.evaluate timeout"
    },
    "cpuProfile": {
      "status": "ok"
    },
    "report": {
      "status": "failed",
      "error": "Runtime.evaluate timeout"
    }
  }
}
```

### 23.4 测试场景

建议增加一个高 CPU demo：

```js
while (true) {
  Math.sqrt(Math.random())
}
```

然后验证：

1. `Profiler.start/stop` 是否能返回。
2. `process.memoryUsage()` 是否超时。
3. `analyze` 是否输出 `partial`。
4. `warnings` 是否说明高负载下某些 collector 可能不可用。

### 23.5 对应 PR

- PR: `19 - add high-load analyze behavior tests`
- Branch: `codex/node-monitoring-17-high-load-boundary`
- Scope:
  - 增加高 CPU demo。
  - 验证 partial 语义。
  - 文档化 memory/report 在主线程卡死时的限制。
- 不做：
  - 不保证所有高负载场景都能稳定采集。

## 24. 第二十节：自动触发诊断

飞书文档里提到了自动采集：CPU 负载高时自动采集 CPU Profile，内存负载高时自动采集 Heapsnapshot，GC 负载高时自动采集 GC Profile，Libuv Handle 个数异常时自动采集诊断报告。

这不是第一刀，但它是 NodeAgent 的重要价值。

### 24.1 自动触发规则

| 触发条件 | 自动动作 |
| --- | --- |
| CPU 负载高 | 采集 CPU Profile |
| 内存负载高 | 采集 Heap Snapshot 或 memory summary |
| GC 负载高 | 采集 GC Profile 或 report |
| Libuv Handle 个数异常 | 采集 process.report |
| fd 个数异常 | 采集文件描述符列表 |
| event loop 延迟高 | 采集 report 和最近指标窗口 |

### 24.2 为什么不能第一刀就做

自动触发依赖三个前提：

1. 要有持续指标采样。
2. 要有 Agent 或 SDK 内部状态保存最近窗口。
3. 要有采集动作的限频和保护，避免故障时反复打爆进程。

因此它属于 NodeAgent 阶段，不属于 `mito-node analyze` 第一刀。

### 24.3 最小策略

第一版自动触发只做：

1. 单进程。
2. 本地 Agent。
3. 最近 60 秒指标窗口。
4. 每类动作至少 5 分钟冷却时间。
5. 只写本地 bundle，不上传。

### 24.4 对应 PR

- PR: `20 - define auto diagnostic trigger rules`
- Branch: `codex/node-monitoring-18-auto-diagnostics`
- Scope:
  - 定义自动触发规则。
  - 定义冷却、限频、bundle 产物。
  - 将自动触发接入 NodeAgent roadmap。
- 不做：
  - 不在第一版 CLI 中自动采集。

## 25. 后续完整 PR 路线

当前工作树已经实现了多个章节的本地切片。实际提 PR 时，不要直接 `git add .`；可 review 的文件范围、验证命令、暂不纳入文件和 PR body 模板见 `docs/solutions/node-monitoring-pr-slices.md`。精确 stage 用 `scripts/stage-node-monitoring-pr-slice.sh <slice>`，SDK 到 Agent 的端到端验证用 `scripts/smoke-sdk-agent-cli.sh`。

建议实际执行顺序如下：

| 顺序 | PR | 目标 |
| --- | --- | --- |
| 1 | `08 - implement first analyze command` | 第一刀，跑通指定 PID 的 analyze |
| 2 | `07 - define analyze bundle contract` | 固化 bundle、summary、JSON 合约 |
| 3 | `02 - harden inspector session lifecycle` | 修 inspector 生命周期 |
| 4 | `04 - collect memory artifact in analyze` | 完善 memory |
| 5 | `05 - collect process report artifact` | 完善 report |
| 6 | `06 - collect cpu profile artifact` | 完善 cpuprofile |
| 7 | `01 - add stable discover command` | 增加 discover |
| 8 | `09 - separate human tui and agent mode docs` | 分清 TUI 和 Agent 模式 |
| 9 | `10 - add Codex node process analyze skill` | 增加 Codex Skill |
| 10 | `11 - add Claude Code node process analyze adapter` | 增加 Claude Code 适配 |
| 11 | `12 - define NodeAgent MVP contract` | 定义 NodeAgent MVP |
| 12 | `13 - connect SDK collectors to local agent` | 打通 SDK 到 Agent 指标链路 |
| 13 | `14 - add CLI agent query commands` | CLI 查询 Agent |
| 14 | `15 - add CLI contract tests and build gates` | 合约测试和构建门禁 |
| 15 | `16 - align roadmap with original Feishu planning` | 对齐飞书原始规划的 P0/P1/P2 |
| 16 | `17 - define agent communication endpoints` | 收敛 UDS/TCP/HTTP endpoint 命名 |
| 17 | `18 - expose standalone monitoring subjects` | 支持轻量 Subject 单功能接入 |
| 18 | `19 - add high-load analyze behavior tests` | 验证 CPU 100% 下 partial 语义 |
| 19 | `20 - define auto diagnostic trigger rules` | 定义自动触发诊断规则 |

注意：表格顺序和章节编号不完全一致。章节按学习顺序组织，PR 按交付价值排序。第一刀应该先做 `analyze`，因为它最能证明方向成立。

## 26. 每节学习产出

每节合入后，都要留下三类产出：

1. 代码产出：对应 CLI、SDK、Agent 或 skill 的实际变更。
2. 文档产出：更新本小册对应章节的“当前状态”和“下一步”。
3. 验证产出：PR 描述里贴命令、stdout JSON、bundle 文件列表。

建议每个 PR 合入后，在本小册追加一段：

```markdown
### PR status

- PR: #<number>
- Commit: abc123
- Verified command: <command>
- Bundle example: <path>
- Remaining gaps: <gaps>
- Superpower flow: <skills used>
```

这样小册会变成项目进度账本，而不是一次性文档。

## 27. 第一刀汇报口径

如果要给别人汇报，可以这样说：

1. 我先做 `mito-node analyze --pid --json`，目标是把 Node 进程分析从交互式命令收敛成稳定 CLI 合约。
2. 这一刀会完成五件事：找到目标 PID、判断或开启 inspector、拉 memory/report/cpuprofile、写本地 bundle、输出机器可读 JSON。
3. 给用户用的时候，后续可以接 TUI，引导用户一步步看 memory、CPU、report；给 Agent 用的时候，不走交互，直接输出 JSON 和 bundle 路径。
4. JSON 不承载所有诊断内容，它只告诉 Agent：bundle 在哪、哪些文件生成了、哪些采集失败了、下一步该读哪个文件。
5. 首版不接 Rust Agent、不做上传、不做 MCP，先把本地一次性诊断闭环做稳。后续再基于同一个 CLI 合约接 Codex Skill、Claude Code 和 NodeAgent。

## 28. 参考资料

- Node.js `process.memoryUsage()`、`process.resourceUsage()`、`process.report`: <https://nodejs.org/api/process.html>
- Node.js `v8.getHeapStatistics()`、`v8.writeHeapSnapshot()`: <https://nodejs.org/api/v8.html>
- Node.js inspector: <https://nodejs.org/api/inspector.html>
- Node.js `--heapsnapshot-near-heap-limit`: <https://nodejs.org/api/cli.html#--heapsnapshot-near-heap-limitmax_count>
- Chrome DevTools Protocol Profiler: <https://chromedevtools.github.io/devtools-protocol/v8/Profiler/>
- Clinic.js: <https://github.com/clinicjs/node-clinic#readme>
- PM2: <https://github.com/Unitech/pm2>
- Claude Code slash commands: <https://docs.anthropic.com/en/docs/claude-code/slash-commands>
- Claude Code skills: <https://docs.anthropic.com/en/docs/claude-code/skills>

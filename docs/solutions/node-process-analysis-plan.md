# 稳定 Node 进程分析 CLI + Codex / Claude Code 适配技术方案

## 1. 目标

把当前 `@mitojs/node-cli` 从一组偏实验性的低层命令，收敛成一个稳定、可脚本调用、可被不同 agent CLI 复用的 Node 进程分析合约。

这里的核心目标不是“做一个只给 Codex 用的 skill”，而是先做一个 **vendor-neutral 的诊断内核**，让下面这些入口都能复用同一套能力：

- 人工命令行直接调用
- Codex CLI / Codex skill
- Claude Code
- 其他能执行 shell 命令并读取本地文件的 agent CLI

换句话说，首版真正要稳定下来的不是某个平台专有扩展，而是：

1. 稳定的 CLI 命令名与参数
2. 稳定的 JSON 返回结构
3. 稳定的本地 bundle 文件布局

只要这三层稳定，Codex、Claude Code、后续 MCP 或插件包装都只是“接入层”，不是核心产品本体。

首版只做三层：

1. 稳定 CLI 合约：`mito-node discover` 和 `mito-node analyze`
2. repo-local Codex skill：消费上面的 CLI 合约，不自己做采集
3. Claude Code 适配约定：同样消费 CLI 合约和 bundle，不新增采集逻辑

如果从产品定位上再细化，首版有 4 个明确子目标：

### 1.1 统一采集入口

无论上层是 Codex、Claude Code 还是纯 shell 脚本，都通过：

- `mito-node discover`
- `mito-node analyze`

进入系统，而不是各自实现一套 PID 发现、inspector attach、profile/report 采集逻辑。

### 1.2 统一诊断产物

所有上层入口都消费同一个本地 bundle：

- `manifest.json`
- `summary.json`
- `summary.md`
- `memory.json`
- `process.report.json`
- `cpu.cpuprofile`

这样可以保证：

- Codex 和 Claude Code 看到的是同一份事实
- 不同 agent 的结论差异只来自解释层，不来自采集层
- 人可以手工打开同一份 bundle 复核

### 1.3 统一失败语义

无论谁来调用 CLI，都遵循同一套：

- 退出码
- `success / partial / failed`
- `warnings / errors`

这样 Claude Code 和 Codex 都可以根据同一套状态机决定是否继续诊断。

### 1.4 平台适配解耦

- Codex 适配层用 skill
- Claude Code 适配层用命令约定和 repo 内文档/提示约定
- 后续如果需要，再加 Codex plugin 或 MCP

也就是说，**适配层可以变化，CLI 合约不能飘**。

首版明确不做：

- 不接 Rust agent
- 不做在线上传
- 不做 MCP-first
- 不做 Windows 支持
- 不把现有 Ink 交互界面当作正式接口
- 不做 Claude Code 专有插件或专有协议

## 2. 当前项目状态

### 2.1 已有基础

当前仓库已经有 3 块可复用基础：

- `packages/node-cli`：已经能通过 inspector 做 `cpuprofile`、`heapsnapshot`、`report`、`memory`、`run-code`
- `packages/node`：有 SDK、collector、subject 雏形
- `agent`：有 Rust sidecar、HTTP 和 store 雏形

其中 CLI 的现有入口和核心逻辑主要在：

- `packages/node-cli/src/index.ts`
- `packages/node-cli/src/cli.ts`
- `packages/node-cli/src/shared/command.ts`

### 2.2 当前关键问题

#### P0：不解决就无法产品化

1. 缺稳定 CLI 合约  
   当前 CLI 是一组 ad hoc 命令，没有正式的 `discover/analyze` 接口，skill 和其他 CLI 无法稳定依赖。

2. inspector 生命周期不安全  
   当前实现默认 `SIGUSR1 + 9229`，且执行结束时无条件关闭 inspector。  
   这会带来两个问题：
   - 可能连到错误进程
   - 可能把原本就开着的 inspector 关掉

3. 进程发现能力太弱  
   当前只用 `pgrep node` + `ps`，没有：
   - PID 合法性校验
   - inspect 端口归属校验
   - 非 `node` 变体识别
   - 多候选进程的稳定输出

4. 构建是坏的  
   本地验证里，`pnpm --filter @mitojs/node-cli build` 会因为 Rollup 多 chunk 与 `output.file` 配置冲突而失败。

5. 测试在当前环境不可稳定运行  
   本地验证里，`pnpm --filter @mitojs/node test` 和 `pnpm --filter @mitojs/node-cli test` 会被 Watchman 权限问题打断。

#### P1：不解决会影响可用性和可信度

1. `upload()` 是空实现，输出的在线地址不可信
2. `monitor-cpu` 当前是随机数演示，不应进入稳定接口
3. `interactive-cli.tsx` 没接正式 bin，不应被视为正式产品面
4. 还没有 bundle schema、错误分级、partial success 语义

#### P2：当前仓库长期方向，但不是首版前置

1. `packages/node` 到 Rust agent 的主链路没有打通
2. Node proxy HTTP 还是 stub
3. agent 的订阅、动作处理还是 TODO
4. 当前本机 `cargo` 环境异常，Rust 不适合作为首版依赖

## 3. 推荐架构

推荐走 `portable core + agent adapters`：

```text
Human CLI / Codex CLI / Claude Code / Other Agent CLI
                        |
                        v
               mito-node discover
               mito-node analyze
                        |
                        v
               Inspector session manager
                        |
                        v
                  Target Node process
                        |
                        v
              local bundle dir + JSON result
```

核心原则：

- 稳定面只收敛到命令名、参数、JSON 结果、bundle 文件布局
- 交互 UI、上传、agent 通信都不进入正式合约
- Codex skill 和 Claude Code 都只消费 CLI，不反向依赖内部模块

### 3.1 为什么这套结构同时适配 Codex 和 Claude Code

因为 Codex CLI 和 Claude Code 有一个共同点：都能做两件事。

1. 执行本地 shell 命令
2. 读取本地文件

而本方案把 Node 诊断能力正好压缩成这两个能力边界：

1. 运行 `mito-node discover` / `mito-node analyze`
2. 读取 bundle 内的 `summary.md`、`summary.json`、`memory.json`、`process.report.json`

因此它不会把产品绑定在某个 agent 平台的扩展机制上。

### 3.2 首版兼容性判断

首版默认兼容：

- 手工 shell
- Codex CLI
- Claude Code
- 其他能执行 shell + 读本地文件的 agent

首版不直接兼容：

- 只能通过 HTTP/MCP 访问、但不能执行本地命令的远程 agent
- 完全不允许本地文件访问的托管环境

这类场景要等后续 MCP/server 化再解决。

## 4. 稳定 CLI 合约设计

### 4.1 `mito-node discover`

#### 命令

```bash
mito-node discover [--json] [--all]
```

#### 用途

列出候选 Node 进程，供：

- 用户手工选 PID
- Codex skill 选进程
- Claude Code 选进程
- 其他 agent CLI 或脚本复用

#### 稳定 JSON 字段

每个进程对象至少包含：

- `pid`: number
- `ppid`: number
- `command`: string
- `startTime`: string
- `cpuTime`: string
- `inspector.enabled`: boolean
- `inspector.port`: number | null

#### 文本输出

文本模式只给人看，建议输出表格：

- PID
- PPID
- START
- CPU
- INSPECTOR
- COMMAND

#### `--all` 语义

建议默认排除当前 `mito-node` 自身进程，`--all` 用于包含它。

### 4.2 `mito-node analyze`

#### 命令

```bash
mito-node analyze \
  --pid <pid> \
  [--port <port>] \
  [--out-dir <dir>] \
  [--duration <ms>] \
  [--cpu-profile on|off] \
  [--report on|off] \
  [--memory on|off] \
  [--json]
```

#### 默认值

- `duration=10000`
- `cpu-profile=on`
- `report=on`
- `memory=on`

#### 用途

一键采集稳定的本地分析包，并返回机器可读结果。

这是给 Codex 和 Claude Code 共同消费的核心命令，不应在不同 agent 里派生出不同参数语义。

### 4.3 analyze JSON 返回

`--json` 只打印一个固定对象：

```json
{
  "status": "success | partial | failed",
  "pid": 12345,
  "bundleDir": "/abs/path/to/bundle",
  "artifacts": {
    "manifest": "/abs/path/to/manifest.json",
    "summaryJson": "/abs/path/to/summary.json",
    "summaryMd": "/abs/path/to/summary.md",
    "memory": "/abs/path/to/memory.json",
    "report": "/abs/path/to/process.report.json",
    "cpuProfile": "/abs/path/to/cpu.cpuprofile"
  },
  "warnings": [],
  "errors": []
}
```

### 4.4 退出码

- `0`：至少生成了可用 bundle，允许是 `partial`
- `1`：没有生成可用 bundle

### 4.5 bundle 固定文件布局

目录内固定文件名：

- `manifest.json`
- `summary.json`
- `summary.md`
- `memory.json`
- `process.report.json`
- `cpu.cpuprofile`

其中：

- `manifest.json`：执行元信息、采集开关、warnings/errors、artifact 路径
- `summary.json`：机器可读的确定性摘要
- `summary.md`：给人和 skill 优先读的摘要

### 4.6 inspector 生命周期规则

这是稳定合约最重要的地方。

1. 先检测目标进程是否已经有 inspector
2. 优先用 `lsof` + 命令行参数判断 inspect 端口
3. 连接前必须验证监听端口归属于目标 PID
4. 只有在目标未开 inspector 时才发送 `SIGUSR1`
5. 只有 CLI 自己打开的 inspector 才能在结束时关闭
6. 如果目标原本就处于 inspect 状态，CLI 绝不调用 `inspector.close()`

### 4.7 为什么 CLI 合约是跨 agent 的真正接口

对 Codex 来说，skill 只是调用者。

对 Claude Code 来说，命令约定也是调用者。

因此真正的接口层级应该这样看：

```text
Node diagnostics product API = mito-node discover/analyze + bundle schema
Codex skill = adapter
Claude Code workflow = adapter
Plugin / MCP = future adapter
```

这也是首版不优先做 plugin-first 或 MCP-first 的原因。

### 4.8 低层命令的定位

现有低层命令保留，但降级为 power-user 接口：

- `cpuprofile`
- `heapsnapshot`
- `report`
- `memory`
- `run-code`
- `start-inspect`
- `stop-inspect`

其中 `monitor-cpu` 在去掉随机数实现前，不进入稳定合约。

## 5. 第一刀：先把 `mito-node analyze` contract 落地

这一刀只做一件事：

**把 `@mitojs/node-cli` 里的 `mito-node analyze --pid ... --json` 做成稳定接口。**

这里的 “CLI” 不是泛指命令行，而是当前仓库里的这个包和命令入口：

- 包：`packages/node-cli`
- 命令：`mito-node`

第一刀的设计目标不是把采集能力做到最强，而是先把“外部怎么看这个产品”定死。  
也就是先把下面 4 个东西稳定下来：

1. 命令名和参数
2. JSON 返回结构
3. bundle 文件布局
4. 成功 / 部分成功 / 失败语义

### 5.1 为什么第一刀先做 analyze，不先做 discover

`discover` 解决的是“怎么选进程”。  
`analyze` 解决的是“怎么定义这个产品的核心输出”。

从系统边界上看，真正不能轻易返工的是：

- `mito-node analyze` 的参数
- `mito-node analyze --json` 的字段
- bundle 里有哪些文件

而 `discover` 的演进空间更大，后补成本更低。

所以第一刀优先做：

```bash
mito-node analyze --pid <pid> --json
```

让它先成为所有上层入口共同依赖的“最小稳定核心”。

### 5.2 第一刀明确范围

第一刀包含：

- `mito-node analyze` 正式 subcommand
- 参数解析
- inspector 生命周期最小安全封装
- memory / report / cpuprofile 的串行采集
- 本地 bundle 写入
- 固定 JSON 返回
- 固定退出码

第一刀不包含：

- `discover`
- Codex skill 文件
- Claude Code 命令文件
- Rust agent
- MCP
- 在线上传
- `heapsnapshot`
- 实时监控

也就是说，第一刀只交付一个最小可用、但足够稳定的 analyze 核心。

### 5.3 第一刀对外接口

#### 命令

```bash
mito-node analyze \
  --pid <pid> \
  [--port <port>] \
  [--out-dir <dir>] \
  [--duration <ms>] \
  [--cpu-profile on|off] \
  [--report on|off] \
  [--memory on|off] \
  [--json]
```

#### 参数规则

- `--pid`
  - 必填
  - 必须是正整数
- `--port`
  - 可选
  - 仅作为 inspector 端口 override
- `--out-dir`
  - 可选
  - bundle 输出根目录
  - 默认建议：`<cwd>/mito-node-analysis`
- `--duration`
  - 可选
  - `cpuprofile` 采样时长
  - 默认 `10000`
- `--cpu-profile`
  - `on | off`
  - 默认 `on`
- `--report`
  - `on | off`
  - 默认 `on`
- `--memory`
  - `on | off`
  - 默认 `on`
- `--json`
  - 存在时只输出固定结果对象

#### 第一刀不做的参数

为了避免过早扩展，第一刀不加：

- `--heapsnapshot`
- `--format`
- `--pretty`
- `--stdout-summary`
- `--upload`
- `--mcp`

### 5.4 第一刀 JSON 返回

第一刀必须把这个结构定死：

```json
{
  "status": "success | partial | failed",
  "pid": 12345,
  "bundleDir": "/absolute/path/to/bundle",
  "artifacts": {
    "manifest": "/absolute/path/to/manifest.json",
    "summaryJson": "/absolute/path/to/summary.json",
    "summaryMd": "/absolute/path/to/summary.md",
    "memory": "/absolute/path/to/memory.json",
    "report": "/absolute/path/to/process.report.json",
    "cpuProfile": "/absolute/path/to/cpu.cpuprofile"
  },
  "warnings": [],
  "errors": []
}
```

字段含义：

- `status`
  - `success`：请求的核心 artifact 全部成功
  - `partial`：至少有一个核心 artifact 成功，但有失败项
  - `failed`：没有得到任何可用核心 artifact
- `bundleDir`
  - 必须是绝对路径
- `artifacts.*`
  - 成功时给绝对路径
  - 未生成时给 `null`
- `warnings`
  - 非致命问题
- `errors`
  - 影响结果完整性的错误

#### 第一刀退出码

- `0`
  - `success`
  - `partial`
- `1`
  - `failed`

原因：对上层 agent 来说，`partial` 通常仍然有诊断价值，不应直接被当成硬失败。

### 5.5 第一刀 bundle 文件布局

第一刀先固定这 6 个文件名：

- `manifest.json`
- `summary.json`
- `summary.md`
- `memory.json`
- `process.report.json`
- `cpu.cpuprofile`

建议目录结构：

```text
<out-dir>/
  <pid>-<timestamp>/
    manifest.json
    summary.json
    summary.md
    memory.json
    process.report.json
    cpu.cpuprofile
```

#### 文件职责

- `manifest.json`
  - 请求参数
  - 采集时间
  - artifact 路径
  - warnings / errors
- `summary.json`
  - 给机器消费的结构化摘要
- `summary.md`
  - 给人和 agent 优先阅读的摘要
- `memory.json`
  - 内存相关原始数据
- `process.report.json`
  - runtime report 原始数据
- `cpu.cpuprofile`
  - Chrome DevTools 可直接加载的 profile

### 5.6 第一刀内部实现切分

第一刀建议拆成 4 个内部模块。

#### 模块 1：命令入口

职责：

- 定义 `analyze` 子命令
- 做参数校验
- 调用 analyze service
- 输出 JSON / 文本
- 设定退出码

建议落点：

- `packages/node-cli/src/index.ts`

#### 模块 2：inspector session manager

职责：

- 判断目标进程是否已有 inspector
- 必要时发送 `SIGUSR1`
- 校验监听端口属于目标 PID
- 建立 websocket 连接
- 执行 Runtime / Profiler 调用
- 在结束时只关闭“自己打开的 inspector”

建议新建模块：

- `packages/node-cli/src/inspector.ts`

#### 模块 3：analyze service

职责：

- 串行执行 memory / report / cpuprofile
- 聚合 warnings / errors
- 计算 `status`
- 写 bundle
- 返回固定结果对象

建议新建模块：

- `packages/node-cli/src/analyze.ts`

#### 模块 4：bundle writer / summary builder

职责：

- 生成 bundle 目录
- 写固定文件名
- 构建 `summary.json`
- 构建 `summary.md`

可以先内嵌在 `analyze.ts`，不强行再拆一层。  
第一刀优先求稳，不追求抽象漂亮。

### 5.7 第一刀建议改动文件

#### 必改

- `packages/node-cli/src/index.ts`
  - 从“全局命令 + pid 必填”改成真正的 subcommand 入口
- `packages/node-cli/src/cli.ts`
  - 第一刀建议不要继续往这里堆 analyze 逻辑
  - 可以保留旧命令，作为 legacy/power-user 路径

#### 新增

- `packages/node-cli/src/analyze.ts`
- `packages/node-cli/src/inspector.ts`

#### 可能补充

- `packages/node-cli/src/shared/command.ts`
  - 后续 discover 会用到，但第一刀只在需要时做最小 PID / 端口辅助逻辑
- `packages/node-cli/src/helper.ts`
  - 可以复用文件名/路径辅助，但不要继续往里塞上传逻辑

### 5.8 第一刀实现顺序

建议严格按下面顺序做，避免一开始就掉进 inspector 细节里。

#### Step 1：先建 analyze 命令骨架

先在 `index.ts` 里定义：

- `mito-node analyze`
- 参数解析
- 空的 result object

此时哪怕还没真正采到数据，也先把：

- 参数名
- JSON 结构
- bundleDir 生成方式
- 退出码规则

固定下来。

#### Step 2：实现 bundle 最小写入

先让 analyze 能生成：

- `manifest.json`
- `summary.json`
- `summary.md`

哪怕里面内容先很薄，也先把文件布局定住。

#### Step 3：实现 inspector session manager

再处理 attach 逻辑：

1. 检查目标是否为 Node 进程
2. 检查是否已开 inspector
3. 没开才 `SIGUSR1`
4. 校验 port 属于目标 PID
5. 建立 websocket
6. 标记 `openedByCli`

#### Step 4：串行接入 3 个 collector

按这个顺序：

1. memory
2. report
3. cpuprofile

原因：

- memory 最轻
- report 次之
- cpuprofile 最慢，最容易失败

#### Step 5：补 status 与 summary

最后再统一算：

- `success`
- `partial`
- `failed`

并生成：

- `summary.json`
- `summary.md`

### 5.9 第一刀的最小安全规则

第一刀至少要守住下面这些规则。

#### 规则 1：不误关 inspector

如果目标进程原本已经开了 inspector，分析结束后不能关。

#### 规则 2：不误连 inspector

如果用户指定的端口不是目标 PID 的监听端口，必须报错，而不是直接尝试连。

#### 规则 3：partial 有产物就返回 0

只要已经收到了至少一个核心 artifact，就不要用退出码把上层工作流直接打死。

#### 规则 4：summary 只写确定性结论

不要在 CLI 里做“可能泄漏”“怀疑业务逻辑异常”这种 LLM 风格结论。  
CLI 只写可复核的观察。

### 5.10 第一刀的验收标准

做到下面这些，就算第一刀完成：

1. 可以执行：

```bash
mito-node analyze --pid 12345 --json
```

2. 命令能返回固定 JSON 结构
3. 命令能创建固定 bundle 文件布局
4. 至少能稳定采到以下 3 项中的任意 1 项：
   - memory
   - report
   - cpuprofile
5. `success / partial / failed` 语义清晰
6. 不会误关原本就存在的 inspector
7. 不会误连错误 PID 的 inspector

### 5.11 第一刀完成后，第二刀再做什么

第一刀完成后，再进入第二刀：

- `mito-node discover --json`
- Codex skill
- Claude Code 命令约定 / 文档

也就是说，第一刀先把“分析核心”稳定下来；第二刀再补“怎么选进程、怎么接不同 agent”。

## 6. bundle 内容建议

### 6.1 `memory.json`

建议至少包含：

- `process.memoryUsage()`
- `process.resourceUsage()`（如果可用）
- `v8.getHeapStatistics()`
- `v8.getHeapSpaceStatistics()`
- `uptime`

### 6.2 `process.report.json`

建议优先使用：

- `process.report.getReport()`

避免依赖在线上传或额外外部系统。

### 6.3 `summary.json`

建议包含：

- `pid`
- `command`
- `status`
- `collectedAt`
- `startTime`
- `cpuTime`
- `inspector.port`
- `inspector.openedByCli`
- `artifacts`
- `observations`
- `warnings`
- `errors`
- `memoryOverview`

### 6.4 `summary.md`

建议为确定性摘要，不做 LLM 推理，内容包括：

- 状态
- PID
- command
- artifact 路径
- memory overview
- 1~3 条基于阈值的 observations
- warnings / errors

可以做的确定性观察示例：

- `heapUsed / heapTotal > 85%`
- `rss` 明显高于 `heapTotal`
- `external` 占 `heapUsed` 比例过高
- `arrayBuffers` 过高

## 7. Agent 适配设计

### 7.1 适配层总原则

无论是 Codex 还是 Claude Code，适配层都只做三件事：

1. 帮用户选 PID
2. 调用稳定 CLI
3. 读取 bundle 并解释

适配层不做：

- 自己 attach inspector
- 自己写 profile/report/memory 采集逻辑
- 自己定义另一套输出 schema

### 7.2 Codex Skill 设计

#### 技能定位

repo-local skill，不做全局安装，不做插件依赖。

建议路径：

```text
.agents/skills/node-process-analyze/
```

#### 触发范围

以下场景触发：

- 分析 node 进程
- 诊断某个 node pid
- 看 node 内存/CPU
- 查 node 泄漏
- 解释 `mito-node analyze` 结果

#### 工作流

1. 如果用户已经给了 PID，直接运行 `mito-node analyze --pid ... --json`
2. 如果用户没给 PID，先运行 `mito-node discover --json`
3. 如果只发现 1 个候选进程，自动选中
4. 如果发现多个候选进程，回给用户让他选 PID
5. 分析后优先读：
   - `summary.md`
   - `summary.json`
6. 必要时再读：
   - `memory.json`
   - `process.report.json`
   - `cpu.cpuprofile`

#### 输出规则

skill 输出时必须明确区分：

- 观察到的事实
- 由事实推导出的 inference

并且：

- `success`：按正常 bundle 解读
- `partial`：必须指出缺了哪些 artifact
- `failed`：只能转述错误，不能猜结论

#### skill 文件结构

建议：

```text
.agents/skills/node-process-analyze/
├── SKILL.md
├── agents/openai.yaml
└── references/output-schema.md
```

`SKILL.md` 负责：

- 触发说明
- 命令调用顺序
- PID 选择策略
- 输出规则

`references/output-schema.md` 负责：

- `discover` JSON 字段
- `analyze` JSON 字段
- bundle 文件含义

### 7.3 Claude Code 适配设计

Claude Code 首版不需要单独的插件体系，直接复用 CLI 合约和 bundle。

#### 适配方式

建议采用“命令约定 + repo 内文档约定”：

1. Claude Code 先执行：
   - `mito-node discover --json`
   - 或 `mito-node analyze --pid <pid> --json`
2. Claude Code 再读取：
   - `summary.md`
   - `summary.json`
   - 必要时 `memory.json` / `process.report.json`

#### 为什么这样适配

因为 Claude Code 的稳定能力边界本质上也是：

- 跑本地命令
- 读本地文件

所以它不需要一个与 Codex skill 对等的专有实现，只需要一套清晰的仓库内使用约定。

#### 建议交付

在实现阶段，除了 Codex skill 外，再补一份 repo 文档，例如：

- `docs/solutions/node-process-analysis-plan.md`：总体设计
- `docs/usage/claude-code-node-analysis.md`：Claude Code 如何用这套 CLI 合约

这份 Claude Code 文档建议包括：

- PID 发现方式
- analyze 命令模板
- bundle 解读顺序
- `partial/failed` 的处理规则

#### Claude Code 的限制

首版 Claude Code 适配仍依赖：

- 当前工作目录能访问目标机器上的 Node 进程
- 允许执行本地 shell
- 允许读取生成的 bundle

如果未来要支持远程 Claude 或受限沙箱，再考虑 MCP/server 化。

## 8. Optional Codex Plugin Wrapper

插件不在首版范围，但建议预留：

- 目录：`plugins/node-process-analysis/`
- 作用：只做包装，不新增逻辑
- 内容：skill 副本、默认 prompt、展示信息

首版插件不做：

- `mcpServers`
- 认证
- 额外 app/hook

插件职责只是“让 Codex UI 更容易发现和安装”，不是核心运行时。

它不会解决 Claude Code 的适配问题，因为 Claude Code 复用的是 CLI 合约，不是 Codex plugin manifest。

## 9. 推荐实施顺序

### Phase 1：收敛 CLI 核心

目标：把稳定合约做出来。

建议改造点：

1. 重写 `packages/node-cli/src/index.ts`
   - 从“根命令强依赖 PID”改为真正的 subcommands
   - 新增 `discover`
   - 新增 `analyze`

2. 抽出 inspector session manager
   - 管理 attach / evaluate / profile / close
   - 显式区分“原本已开启”和“CLI 自己开启”

3. 重做进程发现逻辑
   - 从单纯 `pgrep node` 改成更可靠的 `ps + 过滤 + lsof + inspector probe`

4. 实现 bundle writer
   - 固定文件名
   - 固定 JSON 返回
   - 固定 status 语义

### Phase 2：稳定构建和测试

目标：让 CLI 可以可靠构建和验证。

建议改造点：

1. 修 `node-cli build`
   - 不再把浏览器/iife 目标当成 CLI 发布前置
   - 改成真正适合 Node CLI 的产物策略

2. 修 Jest 运行环境
   - 显式关闭 Watchman 或提供稳定 fallback

### Phase 3：补 agent 适配层

目标：让 Codex 和 Claude Code 都能稳定消费 CLI 合约。

建议交付：

- `SKILL.md`
- `agents/openai.yaml`
- `references/output-schema.md`
- Claude Code 使用文档

## 10. 验收标准

### 10.1 CLI

1. `mito-node discover --json` 能稳定返回 Node 进程数组
2. `mito-node analyze --pid <pid> --json` 能生成固定 bundle
3. `status=partial` 和 `status=failed` 有清晰语义
4. CLI 不会误关本来就存在的 inspector
5. CLI 不会误连到别的 PID 的 inspector

### 10.2 Codex Skill / Claude Code

1. 用户已给 PID 时，skill 可直接走 analyze
2. 用户未给 PID 时，skill 可先 discover
3. 多候选场景下，skill 会让用户选 PID
4. skill 能优先读 summary，而不是直接扫描大文件
5. skill 不会在 `partial/failed` 状态下做过度结论
6. Claude Code 可以不依赖额外插件，直接通过 shell 调用同一套 discover/analyze
7. Claude Code 和 Codex 对同一个 bundle 的解读入口一致

### 10.3 工程状态

1. `node-cli build` 恢复可用
2. `node` / `node-cli` 测试可稳定执行
3. CLI 不依赖 Rust agent 才能工作

## 11. 结论

当前最合理的路线不是先做 Rust agent、MCP 或 plugin，而是：

1. 先把 `mito-node discover` 和 `mito-node analyze` 做成稳定 CLI 合约
2. 再让 Codex skill 和 Claude Code 都只消费这个合约
3. 最后视需要再包一层 Codex plugin 或 MCP

这样可以把风险压在最小范围内：

- 不依赖未完成的 Rust 主链路
- 不依赖上传服务
- 不依赖 MCP 基础设施
- Codex、Claude Code、skill、plugin、其他 agent CLI 都能共用同一套稳定接口

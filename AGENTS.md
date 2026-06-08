# AGENTS.md

## 项目概述

**@mitojs/node** 是一个 Node.js 性能监控与调试工具集。提供对 Node.js 进程的 CPU 使用率、内存指标、JS 错误和超时异常的实时采集能力，并配备交互式 CLI 工具通过 Inspector 协议进行诊断。

### 架构

系统由三层组成：

- **SDK (`@mitojs/node`)** — 集成到目标 Node.js 应用中。定时运行采集器，启动 Rust Agent 二进制，通过 Worker Thread HTTP 代理进行通信。
- **CLI (`@mitojs/node-cli`)** — 通过 Inspector 协议（WebSocket）连接到目标 Node.js 进程。提供 CPU Profiling、Heap Snapshot、内存信息、进程报告和远程代码注入功能。有两种使用方式：
  - **AI Agent 模式**：供 AI Agent 调用，用于查看 Node.js 进程信息和下发命令。
  - **交互式 TUI 模式**：供人使用，基于 Ink/React 构建终端 UI，实时查看某个 JS 进程的运行信息。
- **Rust Agent (`agent/`)** — 高性能二进制程序，负责 IPC 与数据处理。使用 axum/tokio 构建 HTTP 服务，跨平台编译支持 darwin-arm64、darwin-x64、linux-x64-musl、linux-arm64-musl、win-x64。

### Monorepo 结构

使用 pnpm workspaces + Nx 任务运行器管理。

| 包名               | 路径                 | 描述                                                      |
| ------------------ | -------------------- | --------------------------------------------------------- |
| `@mitojs/node`     | `packages/node/`     | 核心 SDK — 采集器、Rust Agent 管理、Worker Thread 代理    |
| `@mitojs/node-cli` | `packages/node-cli/` | CLI 工具 — Inspector 协议、TUI（Ink/React）、Commander.js |
| `@mono/rollup`     | `utils/rollup/`      | 共享 Rollup 构建工具（`batch-rollup` 命令）               |
| `@mono/tsconfig`   | `utils/tsconfig/`    | 共享 TypeScript 基础配置                                  |
| `@mono/react-19`   | `app/react-19/`      | 示例 React 19 应用（Vite）                                |
| Rust Agent         | `agent/`             | Rust 二进制程序（axum、tokio、serde）                     |

### 核心架构模式

- **Collector/Subject 模式**：`BaseCollector<T>` → 具体采集器；`BaseMonitoringSubject<T>` 继承 RxJS `Subject`，实现响应式数据流。
- **跨平台二进制管理**：`binary.ts` 中进行平台检测，预编译二进制存放于 `packages/node/binaries/`。
- **Worker Thread 隔离**：代理线程（`proxy_thread/`）运行 HTTP 服务（端口 16667），不阻塞主线程即可与 Agent 通信。
- **Inspector 协议**：CLI 使用原生 WebSocket 对接 Chrome DevTools Protocol。
- **Shimmer 模式**：`shared/shimmer.ts` 中的 `wrap`/`unwrap` 用于 monkey-patch 全局对象（setTimeout/setInterval）。

---

## 构建与命令

**前置要求：** Node.js >= 20，pnpm >= 10，Rust 工具链（构建 Agent 时需要）

| 命令                     | 描述                                            |
| ------------------------ | ----------------------------------------------- |
| `pnpm install`           | 安装依赖（`preinstall` 钩子强制使用 pnpm）      |
| `pnpm esm`               | 并行构建 ESM 产物                               |
| `pnpm watch:esm`         | ESM 监听模式构建                                |
| `pnpm build`             | 完整构建（TypeScript + Rollup + Rust Agent）    |
| `pnpm build:rust`        | 仅构建 Rust Agent（`cd agent && ./build.sh`）   |
| `pnpm test`              | 并行运行所有测试                                |
| `pnpm clean`             | 清理构建产物（`dist/`、`esm/`、`.tsbuildinfo`） |
| `pnpm clean:node_module` | 清理所有 `node_modules`                         |
| `pnpm web:dev`           | 启动 React 19 示例应用开发服务器                |
| `pnpm commit`            | 暂存所有文件 + 交互式规范化提交（czg）          |

**包级别构建：**
- `@mitojs/node`：`tsc -b` → `dist/`（CommonJS，ES2020）
- `@mitojs/node-cli`：`tsc -b` → `esm/`，然后 `batch-rollup` → `dist/`（ESM + CJS）

**Nx 任务依赖关系：**
- `rollup` 依赖 `esm`
- `esm` 和 `test` 无前置依赖

---

## 代码风格

**格式化/Lint 工具：** Biome（v2.0.6）— 不使用 ESLint。

| 规则         | 设置                                       |
| ------------ | ------------------------------------------ |
| 缩进         | Tab，宽度 2                                |
| 行宽         | 120                                        |
| 分号         | `asNeeded`（仅在必要时使用）               |
| 引号         | 单引号                                     |
| 尾逗号       | ES5                                        |
| 箭头函数括号 | 始终使用                                   |
| 换行符       | LF                                         |
| Lint 规则    | recommended 规则集；`noExplicitAny` = info |

**TypeScript：**
- 严格模式（`strict: true`，`strictNullChecks: true`）
- 基础 target：`es2015`，module：`esnext`
- `@mitojs/node` 覆盖：target `ES2020`，module `CommonJS`
- `@mitojs/node-cli` 覆盖：module `Node16`，moduleResolution `node16`
- 使用 composite 构建与项目引用

**提交规范：** Conventional Commits，通过 commitlint + czg 执行。scope 来源于 workspace 包名 + `architecture` + `agent`。提交信息中常使用 emoji。

**Git 钩子：** Husky + lint-staged（pre-commit 执行 `npx lint-staged`）。

---

## 注释

生成代码时，以下 6 类关键位置**必须**添加注释说明：

| 类别         | 说明                                | 示例                                                       |
| ------------ | ----------------------------------- | ---------------------------------------------------------- |
| 设计决策     | 解释为什么选择当前方案而非其他方案  | `// 使用 Worker Thread 而非 child_process，避免序列化开销` |
| 平台兼容性   | 标注平台差异或条件分支的原因        | `// Windows 不支持 SIGUSR1，改用 named pipe 激活调试器`    |
| 性能关键路径 | 说明对性能有显著影响的实现细节      | `// 批量合并 IPC 消息，减少系统调用次数`                   |
| 协议约束     | 记录外部协议/规范的限制条件         | `// CDP 协议要求 id 单调递增，不可复用`                    |
| Workaround   | 说明临时方案的背景与移除条件        | `// Node.js < 20.6 不支持 --env-file，手动解析 .env`       |
| 接口契约     | 描述公开 API 的入参、返回值与副作用 | `// 返回的 Observable 在 unsubscribe 后自动停止采集`       |

**原则：**
- 注释解释 **Why**（为什么这样做），而非 **What**（做了什么）——代码本身应能表达 What。
- 如果删除注释后，未来的读者会对代码意图产生疑惑，则该注释是必要的。
- 禁止写无意义的重复注释（如 `// 设置端口` 对应 `setPort(8080)`）。
- 单行注释优先；仅在需要多条信息时使用多行注释块。

---

## 测试

**框架：** Jest + ts-jest

**配置：**
- 根目录 `jest.config.js`：`preset: 'ts-jest'`，`testEnvironment: 'node'`
- 各包配置（`jest.config.cjs`）复用根配置
- 测试文件匹配模式：`**/*.spec.ts`

**测试位置：**
- `packages/node/src/__test__/` — 采集器测试（CPU、JS Error、Timeout）、二进制测试

**运行测试：**
```bash
pnpm test                            # 并行运行所有包的测试
pnpm --filter @mitojs/node test      # 运行单个包的测试
```

---

## 安全

- Rust Agent 二进制以子进程方式启动，通过 fd 3 进行 IPC 通信。确保 `packages/node/binaries/` 中的二进制文件可信且未被篡改。
- Worker Thread 代理服务监听端口 16667 — 仅用于本地 Agent 通信。
- Inspector 协议连接（`@mitojs/node-cli`）使用 SIGUSR1 激活目标进程调试器。仅对自己拥有的进程使用。
- CLI 的远程代码注入功能应仅限于开发/调试环境使用。

---

## 配置

**包管理器：** pnpm（通过 `preinstall` 脚本中的 `only-allow pnpm` 强制）

**工作空间定义**（`pnpm-workspace.yaml`）：
```yaml
packages:
  - 'packages/*'
  - 'utils/*'
  - 'app/*'
```

**关键配置文件：**
- `biome.json` — 格式化与 Lint 规则
- `nx.json` — 任务运行器（6 个并行 worker）
- `commitlint.config.js` — 提交信息校验
- `utils/tsconfig/tsconfig.json` — 共享 TypeScript 基础配置
- `agent/Cargo.toml` — Rust Agent 依赖

**SDK 配置（`@mitojs/node`）：**
`MitoNode` 客户端接收通过 `deepmerge` 合并的选项。采集器按可配置的时间间隔运行，通过 RxJS Subject 发射数据。

**CLI 配置（`@mitojs/node-cli`）：**
CLI 二进制名称为 `mito-node`。使用 Commander.js 解析参数。通过 `--port` / `--host` 选项连接目标进程 Inspector。

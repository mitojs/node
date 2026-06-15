# @mitojs/node

Node.js 应用性能监控 SDK，提供对 CPU 使用率、内存指标、JS 错误和超时异常的实时采集能力。通过 Rust Agent 高性能二进制程序进行 IPC 数据处理，并利用 Worker Thread 隔离代理通信，确保对主线程零阻塞。

## 功能特性

- **CPU 监控** — 实时采集进程 CPU 使用率（总负载 + 用户态负载）
- **内存监控** — 采集堆内存统计、堆空间详情及进程内存使用情况
- **JS 错误捕获** — 监听 `uncaughtException` 和 `unhandledRejection`，实时上报
- **超时追踪** — 劫持 `setTimeout`/`setInterval`，追踪调用栈与定时器状态
- **响应式数据流** — 基于 RxJS Subject 的 Collector/Subject 模式，支持动态订阅与自动 GC
- **Rust Agent 集成** — 自动启动跨平台预编译 Rust 二进制，通过 IPC（fd 3）通信
- **Worker Thread 代理** — 独立工作线程运行 HTTP 服务，不阻塞主线程即可与 Agent 交互
- **跨平台支持** — darwin-arm64、darwin-x64、linux-x64-musl、linux-arm64-musl、win-x64

## 安装

```bash
pnpm add @mitojs/node
```

> **前置要求：** Node.js >= 20

## 快速开始

```typescript
import { MitoNode } from '@mitojs/node'

const mito = new MitoNode({
  metrics: {
    CPU: true,
    Memory: true,
    JSError: true,
  },
})

await mito.start()
```

### 订阅监控数据

```typescript
import { CPUSubject, MemorySubject, JSErrorSubject } from '@mitojs/node'

// CPU 监控
const cpuSubject = new CPUSubject()
const subscription = cpuSubject.subscribe((data) => {
  console.log(`CPU 总负载: ${data.load.toFixed(2)}%`)
  console.log(`CPU 用户态负载: ${data.useLoad.toFixed(2)}%`)
})
cpuSubject.start({ interval: 3000 })

// 内存监控
const memorySubject = new MemorySubject()
memorySubject.subscribe((data) => {
  console.log(`堆已用: ${data.heapInfo.used_heap_size}`)
  console.log(`RSS: ${data.memory.rss}`)
})
memorySubject.start()

// JS 错误监控（事件驱动，无需手动 start）
const jsErrorSubject = new JSErrorSubject()
jsErrorSubject.subscribe((error) => {
  console.error('捕获到未处理错误:', error.message)
})

// 清理资源
subscription.unsubscribe()
```

## 配置选项

### MitoNodeOption

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `metrics.CPU` | `boolean` | `true` | 是否启用 CPU 监控 |
| `metrics.Memory` | `boolean` | `true` | 是否启用内存监控 |
| `metrics.JSError` | `boolean` | `true` | 是否启用 JS 错误捕获 |

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `MITO_AGENT_TCP_PORT` | `16666` | Rust Agent TCP 通信端口 |

### ConfigType（内部配置）

| 属性 | 类型 | 说明 |
|------|------|------|
| `agentTCPPort` | `number` | Agent TCP 端口（默认 16666） |
| `agentHost` | `string` | Agent 主机地址（默认 `localhost`） |
| `pid` | `number` | 当前进程 PID |
| `dir` | `string` | 工作目录 |

## 架构设计

### Collector/Subject 模式

系统采用两层抽象实现监控数据采集与分发：

```
┌─────────────────────────────────────────────────────┐
│                    MitoNode Client                   │
├─────────────────────────────────────────────────────┤
│  Subject 层（响应式数据流）                            │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ CPUSubject  │ │MemorySubject │ │JSErrorSubject│  │
│  └──────┬──────┘ └──────┬───────┘ └──────┬───────┘  │
│         │               │                │          │
│  Collector 层（数据采集）                             │
│  ┌──────┴──────┐ ┌──────┴───────┐ ┌──────┴───────┐  │
│  │CPUCollector │ │MemoryCollect │ │JsErrorCollect│  │
│  └─────────────┘ └──────────────┘ └──────────────┘  │
├─────────────────────────────────────────────────────┤
│  Worker Thread (HTTP Proxy, port 16667)             │
├─────────────────────────────────────────────────────┤
│  Rust Agent (子进程, IPC via fd 3, port 16666)      │
└─────────────────────────────────────────────────────┘
```

#### BaseCollector\<T\>

抽象基类，定义采集器接口：

- `get(): T | undefined` — 获取当前采集数据（轮询类采集器）
- `subscribe?(cb)` — 订阅回调（事件驱动类采集器，如 JS Error）
- `listen?(): () => void` — 启动事件监听（constructor 自动调用），返回清理函数
- `destroy()` — 释放资源

#### BaseMonitoringSubject\<T\>

继承 `ReactiveSubject<T>`（基于 RxJS Subject），提供定时采集调度：

- `start(options?)` — 启动定时采集（默认间隔 5000ms）
- `clearTimer()` — 停止定时器
- `getSubjectName()` — 返回 Subject 名称标识
- `createCollector()` — 工厂方法，创建对应的 Collector 实例

#### ReactiveSubject\<T\>

增强的 RxJS Subject，支持：

- 自动检测订阅者数量，无订阅者时自动 unsubscribe 并触发 teardown
- `addTearDown(fn)` — 注册清理回调，在 unsubscribe 时执行

### Worker Thread 代理

代理线程在独立的 Worker Thread 中运行 HTTP 服务（端口 16667），用于：

- 接收 Rust Agent 下发的监控指令
- 中转主线程与 Agent 之间的通信
- 完全不阻塞主线程的事件循环

启动流程：
1. 主线程创建 Worker，传入序列化的配置
2. Worker 启动 HTTP Server
3. Worker 通过 `parentPort.postMessage` 通知主线程初始化完成
4. Worker 设置 `unref()` 不阻止进程退出

### 跨平台二进制管理

`binary.ts` 负责平台检测与 Rust Agent 生命周期管理：

| 平台 | 二进制名称 |
|------|-----------|
| macOS ARM64 | `mitojs-agent-darwin-arm64` |
| macOS x64 | `mitojs-agent-darwin-x64` |
| Linux x64 | `mitojs-agent-linux-x64-musl` |
| Linux ARM64 | `mitojs-agent-linux-arm64-musl` |
| Windows x64 | `mitojs-agent-win32-x64.exe` |

Agent 进程管理：
- 通过 `spawn` 启动子进程，使用 `stdio: ['inherit', 'inherit', 'inherit', 'ipc']` 配置 fd 3 进行 IPC
- 支持优雅关闭（SIGTERM）和强制终止（5s 超时后 SIGKILL）
- 通过环境变量 `MITO_AGENT_TCP_PORT` 传递端口配置

## API 文档

### MitoNode

主入口类，初始化并启动监控系统。

```typescript
class MitoNode {
  constructor(options?: MitoNodeOption)
  start(): Promise<void>
  destroy(): void
}
```

### 采集器（Collectors）

#### CPUCollector

```typescript
class CPUCollector extends BaseCollector<CPUData> {
  get(): CPUData
}

interface CPUData {
  load: number    // CPU 总负载（%），包含用户态 + 系统态
  useLoad: number // CPU 用户态负载（%）
}
```

#### MemoryCollector

```typescript
class MemoryCollector extends BaseCollector<MemoryData> {
  get(): MemoryData
}

interface MemoryData {
  heapInfo: HeapInfo           // V8 堆统计信息
  heapSpaces: HeapSpaceInfo[]  // V8 各堆空间详情
  memory: NodeJS.MemoryUsage   // 进程内存使用（rss, heapTotal, heapUsed, external）
}
```

#### JsErrorCollector

```typescript
class JsErrorCollector extends BaseCollector<Error> {
  subscribe(cb: (err: Error) => void): void
}
```

事件驱动型采集器，监听 `uncaughtException` 和 `unhandledRejection`。

#### TimeoutCollector

```typescript
class TimeoutCollector extends BaseCollector<TimeoutData> {
  get(): TimeoutData
}

type TimeoutData = Map<number, {
  name: 'setTimeout' | 'setInterval'
  stack: string  // 调用栈路径
  timer: Timer
}>
```

通过 shimmer 模式劫持全局 `setTimeout`/`setInterval`，追踪所有定时器的创建位置。

### Subject（响应式主题）

#### CPUSubject

```typescript
class CPUSubject extends BaseMonitoringSubject<CPUData> {
  getSubjectName(): SubjectNames.CPU
}
```

#### MemorySubject

```typescript
class MemorySubject extends BaseMonitoringSubject<MemoryData> {
  getSubjectName(): SubjectNames.Memory
}
```

#### JSErrorSubject

```typescript
class JSErrorSubject extends BaseMonitoringSubject<Error> {
  getSubjectName(): SubjectNames.JSError
  start(): void  // 无操作 — 错误通过事件监听实时通知
}
```

### MitojsAgent

Rust Agent 进程管理：

```typescript
class MitojsAgent {
  start(args?: string[]): Promise<void>
  stop(): Promise<void>
  getPid(): number | undefined
}

function initAgent(): Promise<MitojsAgent>
```

### Config

泛型配置管理：

```typescript
class Config<T> {
  get<K extends keyof T>(key?: K): T[K] | T | null
  set(data: T): void
  update(data: Partial<T>): void
  destroy(): void
}
```

## 目录结构

```
packages/node/
├── binaries/                  # 预编译 Rust Agent 二进制文件
│   ├── mitojs-agent-darwin-arm64
│   ├── mitojs-agent-darwin-x64
│   ├── mitojs-agent-linux-arm64-musl
│   ├── mitojs-agent-linux-x64-musl
│   └── mitojs-agent-win32-x64.exe
├── src/
│   ├── __test__/              # 单元测试
│   │   ├── collector/
│   │   │   ├── cpu.spec.ts
│   │   │   ├── jsError.spec.ts
│   │   │   └── timeout.spec.ts
│   │   └── binary.spec.ts
│   ├── collector/             # 数据采集器
│   │   ├── base.ts           # BaseCollector 抽象基类
│   │   ├── cpu.ts            # CPU 使用率采集
│   │   ├── memory.ts         # 内存指标采集
│   │   ├── js-error.ts       # JS 错误捕获
│   │   ├── timeout.ts        # 定时器追踪
│   │   └── index.ts
│   ├── subjects/              # 响应式监控主题
│   │   ├── base.ts           # BaseMonitoringSubject 基类
│   │   ├── cpu.ts            # CPU Subject
│   │   ├── memory.ts         # Memory Subject
│   │   ├── js-error.ts       # JSError Subject
│   │   └── index.ts
│   ├── shared/                # 共享工具
│   │   ├── constants.ts      # 常量定义（端口、枚举）
│   │   ├── ReactiveSubject.ts # 响应式 Subject（RxJS 增强）
│   │   ├── http.ts           # HTTP 服务创建
│   │   ├── shimmer.ts        # Monkey-patch 工具（wrap/unwrap）
│   │   ├── stack.ts          # 调用栈解析
│   │   ├── logger.ts         # 日志工具
│   │   ├── is.ts             # 环境检测
│   │   └── utils.ts          # 通用工具函数
│   ├── proxy_thread/          # Worker Thread 代理
│   │   └── index.ts          # HTTP 代理服务主入口
│   ├── binary.ts             # Rust Agent 进程管理
│   ├── client.ts             # MitoNode 客户端
│   ├── config.ts             # 配置管理
│   ├── init.ts               # 初始化逻辑
│   ├── types.ts              # 类型定义
│   ├── request.ts            # 请求工具
│   └── index.ts              # 包入口
├── dist/                      # 构建产物
├── package.json
├── tsconfig.json
└── jest.config.cjs
```

## 开发指南

### 构建

```bash
# 安装依赖
pnpm install

# TypeScript 编译
pnpm --filter @mitojs/node esm

# 监听模式
pnpm --filter @mitojs/node watch:esm

# 完整构建（含 Rust Agent 编译）
pnpm --filter @mitojs/node build

# 仅构建 Rust Agent
pnpm --filter @mitojs/node build:rust
```

### 测试

```bash
# 运行本包测试
pnpm --filter @mitojs/node test

# 运行所有包测试
pnpm test
```

测试框架：Jest + ts-jest，测试文件匹配 `**/*.spec.ts`。

### 代码风格

- 格式化工具：Biome（非 ESLint）
- 缩进：Tab，宽度 2
- 引号：单引号
- 分号：按需（asNeeded）
- 行宽：120

### 依赖

| 依赖 | 用途 |
|------|------|
| `rxjs` | 响应式数据流（Subject/Observable） |
| `deepmerge` | 深度合并用户配置 |

## 许可证

MIT

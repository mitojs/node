# work in progress 🚧
正在开发中，感兴趣可以加入我们
![飞书群](./docs/lark_group.jpg)

# MitoJS Node(README 由 AI 生成)
一个强大的 Node.js 性能监控和调试工具套件，提供实时性能分析、内存监控和代码调试功能。

## 🚀 特性

- **性能分析**: CPU 性能分析、堆快照、内存使用监控
- **实时监控**: 实时 CPU 使用率监控
- **代码调试**: 支持在目标进程中运行代码
- **跨平台**: 支持 macOS、Linux、Windows
- **CLI 工具**: 提供命令行界面，易于集成到开发流程
- **Rust 代理**: 高性能的 Rust 代理程序，提供稳定的数据处理能力

## 📦 包结构

本项目采用 monorepo 架构，包含以下核心包：

- **@mitojs/node**: Node.js SDK，提供性能监控的核心功能
- **@mitojs/node-cli**: 命令行工具，提供交互式的调试和监控界面
- **agent**: Rust 编写的高性能代理程序，负责数据处理和 IPC 通信

## 🛠 安装（开发中）

### 使用 npm

```bash
npm install @mitojs/node @mitojs/node-cli
```

### 使用 pnpm

```bash
pnpm add @mitojs/node @mitojs/node-cli
```

### 使用 yarn

```bash
yarn add @mitojs/node @mitojs/node-cli
```

## 🚀 快速开始

### 1. 在你的 Node.js 应用中集成 SDK

```javascript
// 在应用入口文件中引入
import '@mitojs/node'

// 或者手动初始化
import { init } from '@mitojs/node'

async function startApp() {
  await init()
  // 你的应用代码
}

startApp()
```

### 2. 使用 CLI 工具监控应用

```bash
# 获取进程的 CPU 性能分析（10秒）
mito-node cpuprofile -p <pid> -d 10000

# 获取堆快照
mito-node heapsnapshot -p <pid> -d ./snapshots

# 实时监控 CPU 使用率
mito-node monitor-cpu -p <pid>

# 获取内存信息
mito-node memory -p <pid>

# 在目标进程中运行代码
mito-node run-code -p <pid> -c "console.log('Hello from target process')"

# 从文件运行代码
mito-node run-code -p <pid> -f ./debug-script.js
```

## 📋 CLI 命令详解

| 命令            | 描述                  | 选项                                                           |
| --------------- | --------------------- | -------------------------------------------------------------- |
| `cpuprofile`    | 获取 CPU 性能分析文件 | `-d, --duration <ms>` 分析持续时间（默认10000ms）              |
| `heapsnapshot`  | 获取堆快照            | `-d, --dir <dir>` 保存目录（默认当前目录）                     |
| `memory`        | 获取内存使用信息      | 无                                                             |
| `monitor-cpu`   | 实时监控 CPU 使用率   | 无                                                             |
| `run-code`      | 在目标进程中执行代码  | `-c, --code <code>` 代码字符串<br>`-f, --file <file>` 代码文件 |
| `start-inspect` | 开始调试目标进程      | 无                                                             |
| `stop-inspect`  | 停止调试目标进程      | 无                                                             |
| `report`        | 生成进程报告          | `-d, --dir <dir>` 保存目录（默认当前目录）                     |

## 🏗 开发

### 环境要求

- Node.js >= 20
- pnpm >= 10
- Rust (用于构建 agent)

### 安装依赖

```bash
pnpm install
```

### 构建项目

```bash
# 构建所有包
pnpm build

# 仅构建 TypeScript
pnpm esm

# 仅构建 Rust agent
pnpm build:rust
```

### 开发模式

```bash
# 监听模式构建
pnpm watch:esm

# 启动 React 19 示例应用
pnpm web:dev
```

### 运行测试

```bash
pnpm test
```

## 🏛 架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Node.js App   │    │   CLI Tool      │    │   Rust Agent    │
│                 │    │                 │    │                 │
│  @mitojs/node   │◄──►│@mitojs/node-cli │◄──►│   IPC + HTTP    │
│                 │    │                 │    │                 │
│   SDK集成       │    │   命令行界面    │    │   数据处理      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 核心组件

1. **Node.js SDK** (`@mitojs/node`)
   - 自动初始化 Rust 代理
   - 提供性能监控 API
   - 跨平台二进制文件管理

2. **CLI 工具** (`@mitojs/node-cli`)
   - 基于 Commander.js 的命令行界面
   - 使用 Ink + React 的交互式 UI
   - WebSocket 通信支持

3. **Rust 代理** (`agent`)
   - 高性能数据处理
   - IPC 进程间通信
   - HTTP 服务器
   - 跨平台编译支持

## 🤝 贡献

欢迎贡献代码！请查看 [CONTRIBUTING.md](.github/CONTRIBUTING.md) 了解详细信息。

## 📄 许可证

MIT License - 查看 [LICENSE](LICENSE) 文件了解详细信息。



# mito 贡献指南

## 环境搭建
要运行测试套件和代码检查器，需要先安装 Node.js 和 pnpm。

[`node` 下载](https://nodejs.org/download)
[`pnpm` 下载](https://pnpm.io/)
[`rust` 下载](https://www.rust-lang.org/tools/install)

# mitojs-node
## 安装
首先在项目根目录运行 `pnpm i`。

# Rust Agent
首先运行 `cd agent` 进入 agent 目录。

## 构建二进制
构建跨平台的二进制文件，包括 Windows、macOS 和 Linux，最终会被 @mitojs/node 引用，并通过 `spawn` 启动
```bash
./build.sh
```

# 构建 @mitojs/node
在本地通过 `bun` 或 `ts-node` 运行 `client.ts` 来启动调试 rust Agent

# 构建 @mitojs/node-cli











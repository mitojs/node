# @mitojs/node

给`@mono`提供一系列的核心类与函数

直接用 rollup -c rollup.config.ts --bundleConfigAsCjs --configPlugin typescript 来编译 ts 文件，会导致编译时间过长，因为需要先将.rollup.ts 编译成 .rollup.js 后再进行 input 的编译

## monitor-cpu

实时监控目标 Node.js 进程的 CPU 使用率，并在终端以曲线图展示。

用法示例：

```
mito-node monitor-cpu --pid <目标进程PID> --port <inspector端口>
```
# 验证范围与已知限制

本文保留可随源码分享的验证结论。机器日志、覆盖率 HTML、终端回放、运行历史和诊断文件生成在本地 `docs/reports/`，该目录不纳入 Git；CI 通过 workflow artifacts 保存运行结果。

## 功能验证

2026-10-23 完成 SDK、Rust Agent、CLI 与 C 版 TUI 的本地联调，并补齐闪屏、任务方向键、PID 切换与同屏趋势图回归。源码提交前的检查命令：

```bash
pnpm build
pnpm test
pnpm test:e2e
pnpm --filter @mitojs/node-cli exec tsc --noEmit --incremental false --composite false
cargo test --locked --manifest-path agent/Cargo.toml
```

| 检查 | 已通过的用例 |
| --- | ---: |
| TypeScript 包内单测 | 279（shared 19 / SDK 49 / CLI 211） |
| 构建与包装工具测试 | 11 |
| Rust Agent | 81 |
| 构建 CLI E2E | 20 |

真实 Unix PTY 回归覆盖自动选择 demo PID、CPU / 内存 / 错误 / 定时器数据、方向键选择任务与参数字段、P 切换到另一个自建进程后的 Inspector 数据源、增量重绘和退出清理；120×36 与 80×24 下重建当前终端网格，确认 CPU、RSS 曲线及两条时间轴同屏可见。UI 单测另覆盖 70×20、120×20 短宽窗口、低 CPU 刻度、内存微小波动、结果滚动与下一任务。

工作台改为只更新变化的行。2026-10-22 的闪屏修复样本中，相同示例负载下，240×68 终端的 3 秒稳定窗口，输出从 877416 字节降至 17795 字节，整行擦除序列从 2720 次降至 0 次。这是当时单张 CPU 图的终端输出样本，不代表双图的输出量或 SDK 的 CPU 性能基准。

趋势图按原始采样时间对齐最近 60 秒，连续段中每列取最后一个真实样本绘图，避免密集采样在同一列反复形成竖刺；均值与峰值仍包含全部唯一时间戳的样本。低 CPU 自动缩放，各指标独立判断过期；缺失、来源切换或明显超出采样周期时断线，末样本之后不补线。

README 中保留了[宽屏工作台](assets/tui/workbench-120x36.png)、[紧凑布局](assets/tui/workbench-80x24.png)与[组合诊断](assets/tui/diagnosis-result.png)三张实际会话画面。图片由真实 PTY 输出经 VT 单元格渲染得到，不是原生窗口截图。

## 覆盖率与性能

2026-10-22 首轮完整实现的 TypeScript 加权行覆盖率为 81.28%，SDK 行覆盖率为 81.39%。其后的 TUI 修复增加了测试，但尚未重新汇总覆盖率；这些数值表示当时的快照。

SDK 的基准脚本通过配对的原生 Node / SDK 进程比较计算与高频定时器场景，并单独统计 Agent RSS。高频定时器样本的 CPU 增量中位数为 2.11 个单核百分点，包含 Agent 的 RSS 增量中位数为 12.01 MiB，尚未达到 CPU 增量 1 个百分点的参考目标。不能将样本概括为“零阻塞”或固定开销上限。构建后可运行 `node scripts/benchmark-sdk.cjs --runs 3 --warmup-ms 1000 --duration-ms 6000` 重新测量。

## 平台与发布

实际运行验证覆盖 Darwin ARM64。首轮干净打包安装使用真实 Node.js 20.19.0 / 22.22.2；后续 TUI 回归使用 Node.js 22.22.2。

其余四个平台随仓库保存的 Agent 二进制仍为历史产物。本地运行结果不代表其他平台验收。公开发布前，release workflow 必须重新构建五个平台、核对来源 commit / SHA / manifest，再执行对应平台检查。本轮未运行远端 CI，也未发布 npm；后续 TUI 修复没有重新执行 npm 安装包 smoke。

SDK 的 Windows HTTP 就绪用例曾在并行负载下触发 500ms 超时。该测试验证协议而非启动速度，现使用生产默认的 5000ms 预算；独立用例仍检查 100ms 超时边界。SDK 运行时行为未因此修改，该用例也不等于 Windows 实机验收。

## 文件入库约定

- 保留源码、测试及必要 fixture、demo、构建与发布脚本、锁文件、仓库原有 SDK 平台二进制。
- 保留维护文档与 `docs/assets/` 中经挑选的展示图片。
- 忽略 `.planning/`、`.tmp/`、`docs/reports/`、构建缓存、覆盖率、日志、CPU Profile、Heap Snapshot、终端回放与本地环境配置。
- `.vscode/` 只保留共享的 `launch.json`、`tasks.json` 和 `settings.json`；本机 Agent 配置、缓存、`logs/`、`recordings/` 及 Rust 二进制原子替换临时文件不入库。
- `.gitignore` 不影响 CI 生成和上传 artifacts，也不会删除本地验证数据。

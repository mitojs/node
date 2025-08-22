# Agent 模块

这个 Rust 项目包含两个主要模块：IPC 通信模块和数据处理模块。

## 模块结构

```
src/
├── main.rs           # 主程序入口
├── ipc.rs           # IPC 通信模块
├── data_processor.rs # 数据处理模块
└── mod.rs           # 模块声明文件
```

## IPC 模块 (ipc.rs)

IPC 模块负责进程间通信，提供以下功能：

### 主要组件

- **IpcManager**: IPC 管理器，负责消息的发送和接收
- **IpcMessage**: 消息类型枚举，支持数据、控制、错误和关闭消息
- **ControlCommand**: 控制命令类型

### 功能特性

- 异步消息发送和接收
- 多线程安全的消息处理
- 支持阻塞和非阻塞消息接收
- 内置消息监听器

### 使用示例

```rust
use ipc::{IpcManager, IpcMessage};

// 创建 IPC 管理器
let ipc_manager = IpcManager::new();

// 发送消息
let message = IpcMessage::Data("Hello".to_string());
ipc_manager.send_message(message).unwrap();

// 启动监听器
let _handle = ipc_manager.start_listener(|message| {
    log_print!("收到消息: {:?}", message);
});
```

## 数据处理模块 (data_processor.rs)

数据处理模块负责各种数据的处理、转换和分析。

### 主要组件

- **DataProcessor**: 数据处理器，提供数据处理和缓存功能
- **ProcessedData**: 处理后的数据结构
- **DataType**: 支持的数据类型（JSON、XML、文本、二进制、自定义）
- **ProcessorConfig**: 处理器配置

### 功能特性

- 多种数据格式支持（JSON、XML、文本、二进制）
- 数据验证（基础验证和严格验证）
- 内存缓存机制
- 可配置的处理选项
- 数据压缩支持

### 使用示例

```rust
use data_processor::{DataProcessor, DataType};

// 创建数据处理器
let mut processor = DataProcessor::with_default_config();

// 处理 JSON 数据
let json_data = r#"{"name": "test"}"#;
let result = processor.process_data("key1", json_data, DataType::Json).unwrap();

log_print!("处理结果: {:?}", result.data_type);
```

## 运行项目

```bash
# 检查代码
cargo check

# 运行项目
cargo run

# 运行测试
cargo test
```

## 配置选项

### 数据处理器配置

- `max_cache_size`: 最大缓存大小
- `enable_compression`: 是否启用压缩
- `validation_level`: 数据验证级别（None、Basic、Strict）

### 预设配置

- `default_config()`: 默认配置
- `high_performance_config()`: 高性能配置
- `secure_config()`: 安全配置

## 测试

项目包含完整的单元测试，覆盖主要功能：

```bash
cargo test
```

## 扩展

这些模块设计为可扩展的：

- IPC 模块可以扩展支持更多通信协议
- 数据处理模块可以添加更多数据格式支持
- 可以添加更多的验证规则和处理策略
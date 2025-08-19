mod data_processor;
mod helper;
mod ipc;
mod marco;

use tokio::signal;

use crate::data_processor::subscribe::data_subscription;
use crate::helper::config::AppConfig;
use crate::ipc::tcp::{TcpConfig, TcpSocket};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 加载配置
    let config = AppConfig::from_env();

    // 验证配置
    config
        .validate()
        .map_err(|e| format!("配置验证失败: {}", e))?;

    // 初始化日志
    init_logging(&config);

    println!("🚀 Agent 启动中...");
    config.print_config();

    // 启动 TCP 服务器
    start_tcp_server(&config).await?;

    // 等待关闭信号
    println!("🔄 等待关闭信号...");
    signal::ctrl_c().await.expect("failed to listen for event");
    println!("\n🛑 收到 Ctrl+C 信号，正在优雅关闭...");

    println!("✅ Agent 已优雅关闭");
    Ok(())
}

fn init_logging(_config: &AppConfig) {
    // 简单的日志初始化，可以根据需要替换为更完整的日志系统
    println!("📝 日志系统初始化完成");
}

async fn start_tcp_server(config: &AppConfig) -> Result<(), Box<dyn std::error::Error>> {
    let tcp_config = TcpConfig {
        port: config.tcp.port,
        host: config.tcp.host.clone(),
        heartbeat_interval: config.tcp.heartbeat_interval,
        max_connections: config.tcp.max_connections,
    };

    let tcp_socket = TcpSocket::with_config(tcp_config)
        .await
        .map_err(|e| format!("创建 TCP socket 失败: {}", e))?;

    println!("✅ TCP 服务器启动成功");

    // 设置回调并启动服务器
    let callback = data_subscription();
    tcp_socket.set_callback(callback).await;

    Ok(())
}

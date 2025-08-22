mod data_processor;
mod helper;
mod ipc;
#[macro_use]
mod marco;

use crate::helper::config::AppConfig;
use crate::ipc::http;
use tokio::signal;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    log_print!("🚀 Agent 启动中...");
    let config: AppConfig = AppConfig::from_env();

    // 验证配置
    config
        .validate()
        .map_err(|e| format!("配置验证失败: {}", e))?;

    // 初始化日志
    init_logging(&config);

    config.print_config();

    let config_clone = config.clone();

    let http_handle = tokio::spawn(async move { http::start_http_server(config_clone).await });

    tokio::select! {
        _ = signal::ctrl_c() => {
            log_print!("\n🛑 收到 Ctrl+C 信号，正在关闭...");
        }
        _ = http_handle => {
            log_print!("HTTP 服务器已退出");
        }
    }
    log_print!("✅ Agent 已优雅关闭");
    Ok(())
}

fn init_logging(_config: &AppConfig) {
    // 简单的日志初始化，可以根据需要替换为更完整的日志系统
    log_print!("📝 日志系统初始化完成");
}

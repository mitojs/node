mod data_processor;
mod helper;
mod ipc;
#[macro_use]
mod marco;

use crate::data_processor::store::{ProcessStore, PROCESS_MAP_STORE};
use crate::helper::config::AppConfig;
use crate::ipc::http;
use tokio::signal;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    log_print!("🚀 Agent 启动中...");
    let config: AppConfig = AppConfig::new();

    // 验证配置
    config
        .validate()
        .map_err(|e| format!("配置验证失败: {}", e))?;

    config.print_config();

    let config_clone = config.clone();

    http::http::start_http_server(config_clone).await;

    tokio::select! {
        _ = signal::ctrl_c() => {
            log_print!("\n🛑 收到 Ctrl+C 信号，正在关闭...");
        }
    }
    log_print!("✅ Agent 已优雅关闭");
    Ok(())
}

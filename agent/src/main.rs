mod data_processor;
mod helper;
mod ipc;
#[macro_use]
mod marco;

use crate::helper::config::AppConfig;
use crate::helper::constants::IpcMessageCode;
use crate::ipc::http;
use crate::ipc::process::{send_ipc_message, IpcMessage};
use tokio::signal;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    log_print!("🚀 Agent 启动中...");

    let config: AppConfig = AppConfig::new();

    // 验证配置
    config
        .validate()
        .map_err(|e| format!("配置验证失败: {}", e))?;

    // 初始化日志
    init_logging(&config);

    config.print_config();

    let config_clone = config.clone();

    tokio::spawn(async move {
        match http::start_http_server(config_clone).await {
            Ok(listener_result) => {
                let message = IpcMessage {
                    code: IpcMessageCode::Ok,
                    message: listener_result.to_string(),
                };
                send_ipc_message(message);
            }
            Err(listener_result) => {
                let message = IpcMessage {
                    code: IpcMessageCode::Err,
                    message: listener_result.to_string(),
                };
                send_ipc_message(message);
            }
        }
    });

    tokio::select! {
        _ = signal::ctrl_c() => {
            log_print!("\n🛑 收到 Ctrl+C 信号，正在关闭...");
        }
    }
    log_print!("✅ Agent 已优雅关闭");
    Ok(())
}

fn init_logging(_config: &AppConfig) {
    // 简单的日志初始化，可以根据需要替换为更完整的日志系统
    log_print!("📝 日志系统初始化完成");
}

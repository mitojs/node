use axum::{routing::get, Router};
use tokio::net::{lookup_host, TcpListener};
use tower_http::cors::CorsLayer;

use crate::{
    helper::{
        config::AppConfig,
        constants::{IpcMessageCode, ListenerResultType},
    },
    ipc::process::{send_ipc_message, IpcMessage},
};

use crate::{error_print, log_print};

use super::{
    common::BaseRouter,
    endpoints::{
        heartbeat::HEARTBEAT_ROUTER, info::INFO_ROUTER, update_process::UPDATE_PROCESS_ROUTER,
    },
};

pub async fn get_agent_name() -> &'static str {
    "mitojs-agent"
}

// 设置并启动 HTTP 服务器
pub async fn setup_http_server(
    host: &str,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 路由集合
    let mut app = Router::new()
        .route("/", get(get_agent_name))
        .layer(CorsLayer::permissive()); // CORS 支持

    const ROUTERS: [&dyn BaseRouter; 3] = [&INFO_ROUTER, &UPDATE_PROCESS_ROUTER, &HEARTBEAT_ROUTER];
    for router in ROUTERS {
        app = app.route(router.get_path(), (router.get_handler())());
    }

    // 绑定地址
    log_print!("before bind  addr: {}:{}", host, port);
    // 使用 lookup_host 解析主机名，支持 IPv4 和 IPv6
    let host_port = format!("{}:{}", host, port);
    let mut addrs = lookup_host(&host_port).await?;
    let addr = addrs.next().ok_or("无法解析主机地址")?;

    log_print!("after resolved addr: {}", addr);
    let listener = TcpListener::bind(addr).await?;
    log_print!("HTTP server running on http://{}", addr);

    // 在后台启动服务器，不阻塞当前函数
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            error_print!("HTTP 服务器运行时错误: {}", e);
        }
    });

    // 绑定成功后立即返回
    Ok(())
}

/// 分类服务器启动错误
fn classify_server_error(error: &Box<dyn std::error::Error + Send + Sync>) -> ListenerResultType {
    // 检查是否是 IO 错误且为端口占用
    if let Some(io_error) = error.downcast_ref::<std::io::Error>() {
        return match io_error.kind() {
            std::io::ErrorKind::AddrInUse => ListenerResultType::AddrInUse,
            _ => ListenerResultType::FailedReason(error.to_string()),
        };
    }

    // 检查错误消息中是否包含端口占用关键词
    if error.to_string().contains("Address already in use") {
        ListenerResultType::AddrInUse
    } else {
        ListenerResultType::FailedReason(error.to_string())
    }
}

pub async fn start_http_server(config: AppConfig) {
    tokio::spawn(async move {
        match setup_http_server(&config.tcp.host, config.tcp.port).await {
            Ok(()) => {
                log_print!("HTTP 服务器启动成功");
                let message = IpcMessage {
                    code: IpcMessageCode::Ok,
                    message: ListenerResultType::Success.to_string(),
                };
                send_ipc_message(message);
            }
            Err(e) => {
                error_print!("HTTP 服务器启动失败: {}", e);
                let message = IpcMessage {
                    code: IpcMessageCode::Err,
                    message: classify_server_error(&e).to_string(),
                };
                send_ipc_message(message);
            }
        }
    });
}

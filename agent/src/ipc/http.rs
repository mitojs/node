use axum::{
    extract::Json,
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tokio::net::{lookup_host, TcpListener};
use tower_http::cors::CorsLayer;

use crate::helper::{config::AppConfig, constants::ListenerResultType};

use crate::{error_print, log_print};

#[derive(Serialize)]
struct InfoResponse {
    name: String,
    version: String,
    status: String,
}

#[derive(Deserialize)]
struct UpdateProcessRequest {
    process_id: Option<u32>,
    action: String,
    data: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct UpdateProcessResponse {
    success: bool,
    message: String,
}

pub async fn get_agent_name() -> &'static str {
    "mitojs-agent"
}

// GET /info 接口处理函数
async fn get_info() -> ResponseJson<InfoResponse> {
    let info = InfoResponse {
        name: "mitojs-agent".to_string(),
        version: "0.1.0".to_string(),
        status: "running".to_string(),
    };
    ResponseJson(info)
}

// POST /update_process 接口处理函数
async fn update_process(
    Json(payload): Json<UpdateProcessRequest>,
) -> Result<ResponseJson<UpdateProcessResponse>, StatusCode> {
    // 这里可以根据实际需求处理进程更新逻辑
    log_print!("Received update_process request: {:?}", payload.action);

    // 模拟处理逻辑
    let response = match payload.action.as_str() {
        "start" | "stop" | "restart" => UpdateProcessResponse {
            success: true,
            message: format!("Process {} executed successfully", payload.action),
        },
        _ => UpdateProcessResponse {
            success: false,
            message: "Unknown action".to_string(),
        },
    };

    Ok(ResponseJson(response))
}

// 创建 HTTP 服务器
pub async fn create_http_server(
    host: &str,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 创建路由
    let app = Router::new()
        .route("/", get(get_agent_name))
        .route("/info", get(get_info))
        .route("/update_process", post(update_process))
        .layer(CorsLayer::permissive()); // CORS 支持

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

pub async fn start_http_server(
    config: AppConfig,
) -> Result<ListenerResultType, ListenerResultType> {
    match create_http_server(&config.tcp.host, config.tcp.port).await {
        Ok(()) => {
            log_print!("HTTP 服务器启动成功");
            Ok(ListenerResultType::Success)
        }
        Err(e) => {
            error_print!("HTTP 服务器启动失败: {}", e);
            Err(classify_server_error(&e))
        }
    }
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

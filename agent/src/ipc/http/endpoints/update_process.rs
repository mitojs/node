use axum::{
    extract::Json,
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{post, MethodRouter},
};

use crate::log_print;

use super::super::common::{BaseRouter, UpdateProcessRequest, UpdateProcessResponse};

pub struct UpdateProcessRouter {
    pub path: &'static str,
    pub handler: fn() -> MethodRouter,
}

impl BaseRouter for UpdateProcessRouter {
    fn get_path(&self) -> &'static str {
        &self.path
    }

    fn get_handler(&self) -> fn() -> MethodRouter {
        self.handler
    }
}

pub const UPDATE_PROCESS_ROUTER: UpdateProcessRouter = UpdateProcessRouter {
    path: "/update_process",
    handler: || post(update_process),
};

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

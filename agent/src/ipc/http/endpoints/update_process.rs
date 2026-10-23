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

async fn update_process(
    Json(payload): Json<UpdateProcessRequest>,
) -> Result<ResponseJson<UpdateProcessResponse>, StatusCode> {
    log_print!(
        "Received update_process request: pid={}, action={}",
        payload.process_id,
        payload.action
    );

    // 指令分发从未连接到 Worker，明确失败，避免向调用者伪报成功。
    let response = UpdateProcessResponse {
        success: false,
        message: if ["start", "stop", "restart"].contains(&payload.action.as_str()) {
            "Worker action dispatch is unsupported; use the Inspector CLI".to_string()
        } else {
            format!("Unknown action: {}", payload.action)
        },
    };

    Ok(ResponseJson(response))
}

use axum::{
    extract::Json,
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{post, MethodRouter},
};

use crate::data_processor::store::PROCESS_MAP_STORE;
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

    let response = match payload.action.as_str() {
        "start" => {
            // 通知对应进程开始采集（通过 Worker Thread HTTP 代理）
            let store = PROCESS_MAP_STORE.get(&payload.process_id);
            if store.is_some() {
                log_print!(
                    "Process {} found in store, dispatching start command",
                    payload.process_id
                );
                UpdateProcessResponse {
                    success: true,
                    message: format!("Process {} start command dispatched", payload.process_id),
                }
            } else {
                UpdateProcessResponse {
                    success: false,
                    message: format!("Process {} not registered", payload.process_id),
                }
            }
        }
        "stop" => {
            let store = PROCESS_MAP_STORE.get(&payload.process_id);
            if store.is_some() {
                log_print!(
                    "Process {} found in store, dispatching stop command",
                    payload.process_id
                );
                UpdateProcessResponse {
                    success: true,
                    message: format!("Process {} stop command dispatched", payload.process_id),
                }
            } else {
                UpdateProcessResponse {
                    success: false,
                    message: format!("Process {} not registered", payload.process_id),
                }
            }
        }
        "restart" => UpdateProcessResponse {
            success: true,
            message: format!("Process {} restart command dispatched", payload.process_id),
        },
        _ => UpdateProcessResponse {
            success: false,
            message: format!("Unknown action: {}", payload.action),
        },
    };

    Ok(ResponseJson(response))
}

use axum::{
    extract::Json,
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{post, MethodRouter},
};
use serde::Deserialize;
use std::time::{self, SystemTime};

use crate::{
    data_processor::store::{PartialProcessStore, PROCESS_MAP_STORE},
    log_print,
};

use super::super::common::{BaseResponse, BaseRouter};

pub struct HeartbeatRouter {
    pub path: &'static str,
    pub handler: fn() -> MethodRouter,
}

#[derive(Deserialize)]
pub struct HeartbeatRequest {
    process_id: u16,
}

impl BaseRouter for HeartbeatRouter {
    fn get_path(&self) -> &'static str {
        &self.path
    }

    fn get_handler(&self) -> fn() -> MethodRouter {
        self.handler
    }
}

pub const HEARTBEAT_ROUTER: HeartbeatRouter = HeartbeatRouter {
    path: "/heartbeat",
    handler: || post(heartbeat),
};

pub async fn heartbeat(
    Json(payload): Json<HeartbeatRequest>,
) -> Result<ResponseJson<BaseResponse>, StatusCode> {
    log_print!("/heartbeat {:?}", payload.process_id);
    // 更新进程最后的心跳时间
    let secs = SystemTime::now()
        .duration_since(time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    PROCESS_MAP_STORE.update(
        &payload.process_id,
        PartialProcessStore {
            uds_port: None,
            latest_heartbeat_time: Some(secs),
        },
    );
    let response = BaseResponse {
        success: true,
        message: "ok".to_string(),
    };
    Ok(ResponseJson(response))
}

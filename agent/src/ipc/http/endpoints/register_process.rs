use axum::{
    extract::Json,
    response::Json as ResponseJson,
    routing::{post, MethodRouter},
};
use serde::Deserialize;

use crate::{
    data_processor::store::{ProcessMetrics, ProcessStore, PROCESS_MAP_STORE},
    log_print,
};

use super::super::common::{BaseResponse, BaseRouter};

pub struct RegisterProcessRouter {
    pub path: &'static str,
    pub handler: fn() -> MethodRouter,
}

impl BaseRouter for RegisterProcessRouter {
    fn get_path(&self) -> &'static str {
        &self.path
    }

    fn get_handler(&self) -> fn() -> MethodRouter {
        self.handler
    }
}

pub const REGISTER_PROCESS_ROUTER: RegisterProcessRouter = RegisterProcessRouter {
    path: "/ipc/register_process",
    handler: || post(register_process),
};

#[derive(Deserialize)]
struct RegisterProcessRequest {
    pid: u32,
    #[serde(default)]
    #[allow(dead_code)]
    uds_path: String,
    #[serde(default)]
    subjects: Vec<String>,
    #[serde(default)]
    intervals: std::collections::HashMap<String, u64>,
}

async fn register_process(
    Json(mut payload): Json<RegisterProcessRequest>,
) -> ResponseJson<BaseResponse> {
    log_print!(
        "/ipc/register_process pid={} subjects={:?}",
        payload.pid,
        payload.subjects
    );
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // 错误指标表示观察窗口：健康进程没有错误事件时，空历史仍是有效结果。
    let mut updated_at = std::collections::HashMap::new();
    if payload.subjects.iter().any(|subject| subject == "JSError") {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        updated_at.insert("JSError".to_string(), now_ms);
        payload.intervals.insert("JSError".to_string(), 30000);
    }
    let mut data = PROCESS_MAP_STORE.get_data();
    data.insert(
        payload.pid,
        ProcessStore {
            uds_port: 0,
            latest_heartbeat_time: now,
            metrics: ProcessMetrics::new(),
            registered_subjects: payload.subjects,
            updated_at,
            intervals: payload.intervals,
            truncated: Default::default(),
        },
    );

    ResponseJson(BaseResponse {
        success: true,
        message: "ok".to_string(),
    })
}

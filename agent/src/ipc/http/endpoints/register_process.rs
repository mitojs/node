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
}

async fn register_process(Json(payload): Json<RegisterProcessRequest>) -> ResponseJson<BaseResponse> {
    log_print!("/ipc/register_process pid={} subjects={:?}", payload.pid, payload.subjects);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let mut data = PROCESS_MAP_STORE.get_data();
    data.insert(
        payload.pid,
        ProcessStore {
            uds_port: 0,
            latest_heartbeat_time: now,
            metrics: ProcessMetrics::new(),
            registered_subjects: payload.subjects,
        },
    );

    ResponseJson(BaseResponse {
        success: true,
        message: "ok".to_string(),
    })
}

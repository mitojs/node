use axum::{
    extract::{Json, Path},
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{get, post, MethodRouter},
};
use serde::{Deserialize, Serialize};

use crate::{
    data_processor::store::{ProcessMetrics, PROCESS_MAP_STORE},
    log_print,
};

use super::super::common::BaseRouter;

// GET /metrics/:pid
pub struct MetricsRouter {
    pub path: &'static str,
    pub handler: fn() -> MethodRouter,
}

impl BaseRouter for MetricsRouter {
    fn get_path(&self) -> &'static str {
        &self.path
    }
    fn get_handler(&self) -> fn() -> MethodRouter {
        self.handler
    }
}

pub const METRICS_ROUTER: MetricsRouter = MetricsRouter {
    path: "/metrics/:pid",
    handler: || get(get_metrics),
};

#[derive(Serialize)]
struct MetricsResponse {
    success: bool,
    data: Option<ProcessMetrics>,
    registered_subjects: Vec<String>,
}

async fn get_metrics(Path(pid): Path<u32>) -> ResponseJson<MetricsResponse> {
    log_print!("/metrics/{}", pid);
    let data = PROCESS_MAP_STORE.get_data();
    let store = data.get(&pid);
    ResponseJson(MetricsResponse {
        success: store.is_some(),
        data: store.map(|s| s.metrics.clone()),
        registered_subjects: store.map(|s| s.registered_subjects.clone()).unwrap_or_default(),
    })
}

// POST /metrics/push — SDK 推送指标数据
pub struct MetricsPushRouter {
    pub path: &'static str,
    pub handler: fn() -> MethodRouter,
}

impl BaseRouter for MetricsPushRouter {
    fn get_path(&self) -> &'static str {
        &self.path
    }
    fn get_handler(&self) -> fn() -> MethodRouter {
        self.handler
    }
}

pub const METRICS_PUSH_ROUTER: MetricsPushRouter = MetricsPushRouter {
    path: "/metrics/push",
    handler: || post(push_metrics),
};

#[derive(Deserialize)]
struct PushMetricsRequest {
    pid: u32,
    subject: String,
    data: serde_json::Value,
}

async fn push_metrics(
    Json(payload): Json<PushMetricsRequest>,
) -> Result<ResponseJson<serde_json::Value>, StatusCode> {
    log_print!("/metrics/push pid={} subject={}", payload.pid, payload.subject);
    PROCESS_MAP_STORE.update_metrics(&payload.pid, &payload.subject, payload.data);
    Ok(ResponseJson(serde_json::json!({"success": true})))
}

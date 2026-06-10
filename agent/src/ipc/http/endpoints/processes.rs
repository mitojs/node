use std::time::{self, SystemTime};

use axum::{
    extract::Json,
    response::Json as ResponseJson,
    routing::{get, post, MethodRouter},
};
use serde::Deserialize;

use crate::data_processor::store::{MetricType, ProcessStore, PROCESS_MAP_STORE};

use super::super::common::{BaseResponse, BaseRouter};

pub struct ProcessRouter {
    pub path: &'static str,
    pub handler: fn() -> MethodRouter,
}

impl BaseRouter for ProcessRouter {
    fn get_path(&self) -> &'static str {
        &self.path
    }

    fn get_handler(&self) -> fn() -> MethodRouter {
        self.handler
    }
}

#[derive(Deserialize)]
pub struct RegisterProcessRequest {
    pub process_id: u32,
    #[serde(default, alias = "uds_port")]
    pub proxy_port: Option<u16>,
}

#[derive(Deserialize)]
pub struct RecordMetricRequest {
    pub process_id: u32,
    pub metric_type: MetricType,
    pub data: serde_json::Value,
}

pub const LIST_PROCESSES_ROUTER: ProcessRouter = ProcessRouter {
    path: "/processes",
    handler: || get(list_processes),
};

pub const REGISTER_PROCESS_ROUTER: ProcessRouter = ProcessRouter {
    path: "/processes/register",
    handler: || post(register_process),
};

pub const RECORD_METRIC_ROUTER: ProcessRouter = ProcessRouter {
    path: "/metrics",
    handler: || post(record_metric),
};

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

pub async fn list_processes() -> ResponseJson<Vec<ProcessStore>> {
    ResponseJson(PROCESS_MAP_STORE.list_processes())
}

pub async fn register_process(Json(payload): Json<RegisterProcessRequest>) -> ResponseJson<BaseResponse> {
    PROCESS_MAP_STORE.register_process(payload.process_id, payload.proxy_port, unix_seconds());

    ResponseJson(BaseResponse {
        success: true,
        message: "ok".to_string(),
    })
}

pub async fn record_metric(Json(payload): Json<RecordMetricRequest>) -> ResponseJson<BaseResponse> {
    PROCESS_MAP_STORE.record_metric(
        payload.process_id,
        payload.metric_type,
        payload.data,
        unix_seconds(),
    );

    ResponseJson(BaseResponse {
        success: true,
        message: "ok".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_processor::store::{MetricType, PROCESS_MAP_STORE};
    use axum::Json;
    use serde_json::json;

    #[tokio::test]
    async fn register_process_makes_process_queryable() {
        let process_id = 50001;

        let response = register_process(Json(RegisterProcessRequest {
            process_id,
            proxy_port: Some(16667),
        }))
        .await;

        assert!(response.0.success);
        let process = PROCESS_MAP_STORE.get(&process_id).expect("process should exist");
        assert_eq!(process.proxy_port, Some(16667));
    }

    #[test]
    fn register_process_request_accepts_legacy_uds_port_alias() {
        let payload: RegisterProcessRequest = serde_json::from_value(json!({
            "process_id": 50003,
            "uds_port": 16668
        }))
        .expect("legacy payload should deserialize");

        assert_eq!(payload.proxy_port, Some(16668));
    }

    #[tokio::test]
    async fn record_metric_updates_process_metric_snapshot() {
        let process_id = 50002;

        let response = record_metric(Json(RecordMetricRequest {
            process_id,
            metric_type: MetricType::Memory,
            data: json!({ "rss": 100 }),
        }))
        .await;

        assert!(response.0.success);
        let process = PROCESS_MAP_STORE.get(&process_id).expect("process should exist");
        assert_eq!(process.latest_metrics.len(), 1);
        assert_eq!(process.latest_metrics[0].data, json!({ "rss": 100 }));
    }
}

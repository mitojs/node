use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use serial_test::serial;
use tower::ServiceExt;

use crate::data_processor::store::{ProcessMetrics, ProcessStore, PROCESS_DATA, PROCESS_MAP_STORE};
use crate::ipc::http::common::BaseRouter;
use super::heartbeat::HEARTBEAT_ROUTER;
use super::info::INFO_ROUTER;
use super::metrics::{METRICS_PUSH_ROUTER, METRICS_ROUTER};
use super::update_process::UPDATE_PROCESS_ROUTER;

fn clear_store() {
    PROCESS_DATA.lock().unwrap().clear();
}

// ─── GET /info ──────────────────────────────────────────

#[tokio::test]
async fn test_get_info() {
    let app = Router::new().route(INFO_ROUTER.get_path(), (INFO_ROUTER.get_handler())());

    let req = Request::builder()
        .uri("/info")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["name"], "mitojs-agent");
    assert_eq!(json["version"], "0.1.0");
    assert_eq!(json["status"], "running");
}

// ─── POST /update_process ───────────────────────────────

async fn post_update_process(action: &str) -> serde_json::Value {
    let app = Router::new().route(
        UPDATE_PROCESS_ROUTER.get_path(),
        (UPDATE_PROCESS_ROUTER.get_handler())(),
    );

    let body = serde_json::json!({
        "process_id": 1,
        "action": action,
    });

    let req = Request::builder()
        .method("POST")
        .uri("/update_process")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&body).unwrap()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
#[serial]
async fn test_update_process_start() {
    clear_store();
    // 预先注册进程到 Store
    PROCESS_MAP_STORE.set(
        &1,
        ProcessStore {
            uds_port: 0,
            latest_heartbeat_time: 0,
            metrics: ProcessMetrics::new(),
        },
    );
    let json = post_update_process("start").await;
    assert_eq!(json["success"], true);
    assert!(json["message"].as_str().unwrap().contains("start"));
}

#[tokio::test]
#[serial]
async fn test_update_process_stop() {
    clear_store();
    PROCESS_MAP_STORE.set(
        &1,
        ProcessStore {
            uds_port: 0,
            latest_heartbeat_time: 0,
            metrics: ProcessMetrics::new(),
        },
    );
    let json = post_update_process("stop").await;
    assert_eq!(json["success"], true);
}

#[tokio::test]
async fn test_update_process_restart() {
    let json = post_update_process("restart").await;
    assert_eq!(json["success"], true);
}

#[tokio::test]
async fn test_update_process_unknown() {
    let json = post_update_process("explode").await;
    assert_eq!(json["success"], false);
    assert!(json["message"].as_str().unwrap().contains("Unknown action"));
}

// ─── POST /heartbeat ────────────────────────────────────

#[tokio::test]
#[serial]
async fn test_heartbeat_updates_store() {
    clear_store();
    // 先插入一条记录
    PROCESS_MAP_STORE.set(
        &42,
        ProcessStore {
            uds_port: 0,
            latest_heartbeat_time: 0,
            metrics: ProcessMetrics::new(),
        },
    );

    let app = Router::new().route(
        HEARTBEAT_ROUTER.get_path(),
        (HEARTBEAT_ROUTER.get_handler())(),
    );

    let body = serde_json::json!({"process_id": 42});
    let req = Request::builder()
        .method("POST")
        .uri("/heartbeat")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&body).unwrap()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let ps = PROCESS_MAP_STORE.get(&42).unwrap();
    assert!(ps.latest_heartbeat_time > 0);
}

// ─── GET /metrics/:pid ──────────────────────────────────

#[tokio::test]
#[serial]
async fn test_get_metrics_not_found() {
    clear_store();

    let app = Router::new().route(
        METRICS_ROUTER.get_path(),
        (METRICS_ROUTER.get_handler())(),
    );

    let req = Request::builder()
        .uri("/metrics/9999")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["success"], false);
    assert!(json["data"].is_null());
}

// ─── POST /metrics/push + GET /metrics/:pid ─────────────

#[tokio::test]
#[serial]
async fn test_push_and_get_metrics() {
    clear_store();

    // 构建包含两个路由的 app
    let app = Router::new()
        .route(
            METRICS_PUSH_ROUTER.get_path(),
            (METRICS_PUSH_ROUTER.get_handler())(),
        )
        .route(
            METRICS_ROUTER.get_path(),
            (METRICS_ROUTER.get_handler())(),
        );

    // push cpu 数据
    let push_body = serde_json::json!({
        "pid": 7,
        "subject": "cpu",
        "data": {"usage": 88.5}
    });
    let push_req = Request::builder()
        .method("POST")
        .uri("/metrics/push")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&push_body).unwrap()))
        .unwrap();

    let push_resp = app.clone().oneshot(push_req).await.unwrap();
    assert_eq!(push_resp.status(), StatusCode::OK);

    // get metrics
    let get_req = Request::builder()
        .uri("/metrics/7")
        .body(Body::empty())
        .unwrap();

    let get_resp = app.oneshot(get_req).await.unwrap();
    assert_eq!(get_resp.status(), StatusCode::OK);

    let bytes = get_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["success"], true);
    assert_eq!(json["data"]["cpu"]["usage"], 88.5);
}

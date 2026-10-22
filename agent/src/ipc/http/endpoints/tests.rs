use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use serial_test::serial;
use tower::ServiceExt;

use super::heartbeat::HEARTBEAT_ROUTER;
use super::info::INFO_ROUTER;
use super::metrics::{METRICS_PUSH_ROUTER, METRICS_ROUTER};
use super::update_process::UPDATE_PROCESS_ROUTER;
use crate::data_processor::store::{ProcessMetrics, ProcessStore, PROCESS_DATA, PROCESS_MAP_STORE};
use crate::ipc::http::common::BaseRouter;

fn clear_store() {
    PROCESS_DATA.lock().unwrap().clear();
}

// ─── GET /info ──────────────────────────────────────────

#[tokio::test]
async fn test_get_info() {
    let app = Router::new().route(INFO_ROUTER.get_path(), (INFO_ROUTER.get_handler())());

    let req = Request::builder().uri("/info").body(Body::empty()).unwrap();

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
            registered_subjects: Vec::new(),
            updated_at: Default::default(),
            intervals: Default::default(),
            truncated: Default::default(),
        },
    );
    let json = post_update_process("start").await;
    assert_eq!(json["success"], false);
    assert!(json["message"].as_str().unwrap().contains("unsupported"));
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
            registered_subjects: Vec::new(),
            updated_at: Default::default(),
            intervals: Default::default(),
            truncated: Default::default(),
        },
    );
    let json = post_update_process("stop").await;
    assert_eq!(json["success"], false);
}

#[tokio::test]
async fn test_update_process_restart() {
    let json = post_update_process("restart").await;
    assert_eq!(json["success"], false);
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
            registered_subjects: Vec::new(),
            updated_at: Default::default(),
            intervals: Default::default(),
            truncated: Default::default(),
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

    let app = Router::new().route(METRICS_ROUTER.get_path(), (METRICS_ROUTER.get_handler())());

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

    PROCESS_MAP_STORE.set(
        &7,
        ProcessStore {
            uds_port: 0,
            latest_heartbeat_time: 1,
            metrics: ProcessMetrics::new(),
            registered_subjects: vec!["CPU".to_string()],
            updated_at: Default::default(),
            intervals: Default::default(),
            truncated: Default::default(),
        },
    );
    // 构建包含两个路由的 app
    let app = Router::new()
        .route(
            METRICS_PUSH_ROUTER.get_path(),
            (METRICS_PUSH_ROUTER.get_handler())(),
        )
        .route(METRICS_ROUTER.get_path(), (METRICS_ROUTER.get_handler())());

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

#[tokio::test]
async fn info_exposes_verifiable_protocol_and_process_identity() {
    let app = Router::new().route(INFO_ROUTER.get_path(), (INFO_ROUTER.get_handler())());
    let response = app
        .oneshot(Request::builder().uri("/info").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["protocol_version"], 1);
    assert_eq!(json["pid"], std::process::id());
}

#[tokio::test]
#[serial]
async fn heartbeat_unknown_pid_returns_not_found() {
    clear_store();
    let app = Router::new().route(
        HEARTBEAT_ROUTER.get_path(),
        (HEARTBEAT_ROUTER.get_handler())(),
    );
    let request = Request::builder()
        .method("POST")
        .uri("/heartbeat")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"process_id":123}"#))
        .unwrap();
    assert_eq!(
        app.oneshot(request).await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
#[serial]
async fn unsupported_worker_actions_do_not_report_success() {
    let json = post_update_process("restart").await;
    assert_eq!(json["success"], false);
}

#[tokio::test]
#[serial]
async fn metrics_include_subject_freshness_and_bounded_truncation() {
    clear_store();
    PROCESS_MAP_STORE.set(
        &7,
        ProcessStore {
            uds_port: 0,
            latest_heartbeat_time: 1,
            metrics: ProcessMetrics::new(),
            registered_subjects: vec!["CPU".to_string()],
            updated_at: Default::default(),
            intervals: [("CPU".into(), 1000)].into(),
            truncated: Default::default(),
        },
    );
    PROCESS_MAP_STORE.update_metrics(&7, "CPU", serde_json::json!({"load": 2}));
    PROCESS_MAP_STORE.update_metrics(
        &7,
        "Timeout",
        serde_json::json!((0..1005)
            .map(|id| serde_json::json!({"id":id}))
            .collect::<Vec<_>>()),
    );
    let app = Router::new().route(METRICS_ROUTER.get_path(), (METRICS_ROUTER.get_handler())());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/metrics/7")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["updated_at"]["CPU"].as_u64().unwrap() > 1_000_000_000_000);
    assert_eq!(json["intervals"]["CPU"], 1000);
    assert_eq!(json["truncated"]["timers"], 5);
    assert_eq!(json["data"]["timers"].as_array().unwrap().len(), 1000);
}

#[tokio::test]
#[serial]
async fn unregister_is_idempotent_and_cannot_remove_another_pid() {
    clear_store();
    for pid in [7, 8] {
        PROCESS_MAP_STORE.set(
            &pid,
            ProcessStore {
                uds_port: 0,
                latest_heartbeat_time: 1,
                metrics: ProcessMetrics::new(),
                registered_subjects: vec![],
                updated_at: Default::default(),
                intervals: Default::default(),
                truncated: Default::default(),
            },
        );
    }
    use super::unregister_process::UNREGISTER_PROCESS_ROUTER;
    let app = Router::new().route(
        UNREGISTER_PROCESS_ROUTER.get_path(),
        (UNREGISTER_PROCESS_ROUTER.get_handler())(),
    );
    for _ in 0..2 {
        let request = Request::builder()
            .method("POST")
            .uri("/ipc/unregister_process")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"pid":7}"#))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::OK
        );
    }
    assert!(PROCESS_MAP_STORE.get(&7).is_none());
    assert!(PROCESS_MAP_STORE.get(&8).is_some());
}

#[tokio::test]
#[serial]
async fn healthy_error_observation_is_fresh_before_any_error_and_after_heartbeat() {
    clear_store();
    use super::register_process::REGISTER_PROCESS_ROUTER;
    let app = Router::new()
        .route(
            REGISTER_PROCESS_ROUTER.get_path(),
            (REGISTER_PROCESS_ROUTER.get_handler())(),
        )
        .route(
            HEARTBEAT_ROUTER.get_path(),
            (HEARTBEAT_ROUTER.get_handler())(),
        );
    let request = Request::builder()
        .method("POST")
        .uri("/ipc/register_process")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"pid":42,"subjects":["JSError","CPU"],"intervals":{"JSError":5000,"CPU":1000}}"#,
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(request).await.unwrap().status(),
        StatusCode::OK
    );
    let initial = PROCESS_MAP_STORE.get(&42).unwrap();
    assert!(initial.metrics.errors.is_empty());
    assert!(initial
        .updated_at
        .get("JSError")
        .is_some_and(|time| *time > 1_000_000_000_000));
    assert_eq!(initial.intervals.get("JSError"), Some(&30000));
    assert!(!initial.updated_at.contains_key("CPU"));
    {
        let mut data = PROCESS_MAP_STORE.get_data();
        let store = data.get_mut(&42).unwrap();
        store.updated_at.insert("JSError".into(), 1);
        store
            .metrics
            .errors
            .push(serde_json::json!({"message":"earlier","timestamp":123}));
    }
    let request = Request::builder()
        .method("POST")
        .uri("/heartbeat")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"process_id":42}"#))
        .unwrap();
    assert_eq!(app.oneshot(request).await.unwrap().status(), StatusCode::OK);
    let observed = PROCESS_MAP_STORE.get(&42).unwrap();
    assert!(observed.updated_at["JSError"] > 1_000_000_000_000);
    assert_eq!(observed.metrics.errors[0]["timestamp"], 123);
    assert_eq!(observed.metrics.errors.len(), 1);
}

#[tokio::test]
#[serial]
async fn accepts_sdk_timer_push_with_partial_truncation_metadata() {
    clear_store();
    PROCESS_MAP_STORE.set(
        &42,
        ProcessStore {
            uds_port: 0,
            latest_heartbeat_time: 1,
            metrics: ProcessMetrics::new(),
            registered_subjects: vec!["Timeout".into()],
            updated_at: Default::default(),
            intervals: Default::default(),
            truncated: Default::default(),
        },
    );
    let app = Router::new().route(
        METRICS_PUSH_ROUTER.get_path(),
        (METRICS_PUSH_ROUTER.get_handler())(),
    );
    let request=Request::builder().method("POST").uri("/metrics/push").header("content-type","application/json")
        .body(Body::from(r#"{"pid":42,"subject":"Timeout","data":[{"id":1,"name":"setTimeout","stack":"app.js:1:1","destroyed":false}],"truncated":{"timers":3}}"#)).unwrap();
    assert_eq!(app.oneshot(request).await.unwrap().status(), StatusCode::OK);
    let stored = PROCESS_MAP_STORE.get(&42).unwrap();
    assert_eq!(stored.metrics.timers.len(), 1);
    assert_eq!(stored.truncated.timers, 3);
    assert_eq!(stored.truncated.errors, 0);
    assert!(stored.updated_at["Timeout"] > 1_000_000_000_000);
}

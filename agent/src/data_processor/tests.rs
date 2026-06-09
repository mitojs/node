use serial_test::serial;

use super::store::{
    ActionType, CommandType, MetricType, PartialProcessStore, ProcessMetrics, ProcessStore,
    Store, PROCESS_DATA,
};

fn clear_store() {
    PROCESS_DATA.lock().unwrap().clear();
}

fn make_store_entry(uds_port: u16, heartbeat: u64) -> ProcessStore {
    ProcessStore {
        uds_port,
        latest_heartbeat_time: heartbeat,
        metrics: ProcessMetrics::new(),
    }
}

// ─── Store CRUD ──────────────────────────────────────────

#[test]
#[serial]
fn test_store_set_and_get() {
    clear_store();
    let store = Store::new();
    store.set(&1, make_store_entry(8080, 100));

    let result = store.get(&1);
    assert!(result.is_some());
    let ps = result.unwrap();
    assert_eq!(ps.uds_port, 8080);
    assert_eq!(ps.latest_heartbeat_time, 100);
}

#[test]
#[serial]
fn test_store_get_nonexistent() {
    clear_store();
    let store = Store::new();
    assert!(store.get(&9999).is_none());
}

#[test]
#[serial]
fn test_store_remove() {
    clear_store();
    let store = Store::new();
    store.set(&1, make_store_entry(8080, 100));
    assert!(store.get(&1).is_some());

    let removed = store.remove(&1);
    assert!(removed.is_some());
    assert!(store.get(&1).is_none());
}

#[test]
#[serial]
fn test_store_update_partial() {
    clear_store();
    let store = Store::new();
    store.set(&1, make_store_entry(8080, 100));

    // 只更新 heartbeat，uds_port 保持不变
    store.update(
        &1,
        PartialProcessStore {
            uds_port: None,
            latest_heartbeat_time: Some(200),
        },
    );
    let ps = store.get(&1).unwrap();
    assert_eq!(ps.uds_port, 8080);
    assert_eq!(ps.latest_heartbeat_time, 200);

    // 只更新 uds_port，heartbeat 保持不变
    store.update(
        &1,
        PartialProcessStore {
            uds_port: Some(9090),
            latest_heartbeat_time: None,
        },
    );
    let ps = store.get(&1).unwrap();
    assert_eq!(ps.uds_port, 9090);
    assert_eq!(ps.latest_heartbeat_time, 200);
}

#[test]
#[serial]
fn test_store_update_nonexistent() {
    clear_store();
    let store = Store::new();
    // 不存在的 key 调用 update 不应 panic
    store.update(
        &999,
        PartialProcessStore {
            uds_port: Some(8080),
            latest_heartbeat_time: Some(100),
        },
    );
    // 由于 update 只在 key 存在时更新，不存在的 key 不会创建条目
    assert!(store.get(&999).is_none());
}

// ─── update_metrics 分发 ────────────────────────────────

#[test]
#[serial]
fn test_update_metrics_cpu() {
    clear_store();
    let store = Store::new();
    store.update_metrics(&1, "cpu", serde_json::json!({"usage": 50.5}));

    let m = store.get_metrics(&1).unwrap();
    assert!(m.cpu.is_some());
    assert_eq!(m.cpu.unwrap()["usage"], 50.5);
}

#[test]
#[serial]
fn test_update_metrics_memory() {
    clear_store();
    let store = Store::new();
    store.update_metrics(&1, "memory", serde_json::json!({"rss": 1024}));

    let m = store.get_metrics(&1).unwrap();
    assert!(m.memory.is_some());
    assert_eq!(m.memory.unwrap()["rss"], 1024);
}

#[test]
#[serial]
fn test_update_metrics_js_error() {
    clear_store();
    let store = Store::new();
    store.update_metrics(&1, "js_error", serde_json::json!({"message": "ReferenceError"}));
    store.update_metrics(&1, "js_error", serde_json::json!({"message": "TypeError"}));

    let m = store.get_metrics(&1).unwrap();
    assert_eq!(m.errors.len(), 2);
    assert_eq!(m.errors[0]["message"], "ReferenceError");
    assert_eq!(m.errors[1]["message"], "TypeError");
}

#[test]
#[serial]
fn test_update_metrics_timeout() {
    clear_store();
    let store = Store::new();
    store.update_metrics(&1, "timeout", serde_json::json!({"fn": "setTimeout", "ms": 5000}));

    let m = store.get_metrics(&1).unwrap();
    assert_eq!(m.timers.len(), 1);
    assert_eq!(m.timers[0]["fn"], "setTimeout");
}

#[test]
#[serial]
fn test_update_metrics_unknown_subject() {
    clear_store();
    let store = Store::new();
    store.update_metrics(&1, "unknown_subject", serde_json::json!({"x": 1}));

    let m = store.get_metrics(&1).unwrap();
    assert!(m.cpu.is_none());
    assert!(m.memory.is_none());
    assert!(m.errors.is_empty());
    assert!(m.timers.is_empty());
}

#[test]
#[serial]
fn test_update_metrics_auto_creates_store() {
    clear_store();
    let store = Store::new();
    // pid 42 不存在，update_metrics 应自动创建
    assert!(store.get(&42).is_none());
    store.update_metrics(&42, "cpu", serde_json::json!({"usage": 10}));
    assert!(store.get(&42).is_some());
}

#[test]
#[serial]
fn test_get_metrics() {
    clear_store();
    let store = Store::new();
    assert!(store.get_metrics(&1).is_none());

    store.update_metrics(&1, "cpu", serde_json::json!({"usage": 75}));
    let m = store.get_metrics(&1);
    assert!(m.is_some());
    assert!(m.unwrap().last_updated > 0);
}

// ─── ProcessMetrics 默认值 ───────────────────────────────

#[test]
fn test_process_metrics_new() {
    let m = ProcessMetrics::new();
    assert!(m.cpu.is_none());
    assert!(m.memory.is_none());
    assert!(m.errors.is_empty());
    assert!(m.timers.is_empty());
    assert_eq!(m.last_updated, 0);
}

// ─── 枚举 serde 往返 ────────────────────────────────────

#[test]
fn test_enum_serde_metric_type() {
    let val = MetricType::Cpu;
    let json = serde_json::to_string(&val).unwrap();
    assert_eq!(json, "\"cpu\"");

    let parsed: MetricType = serde_json::from_str(&json).unwrap();
    assert!(matches!(parsed, MetricType::Cpu));

    let json2 = serde_json::to_string(&MetricType::Memory).unwrap();
    assert_eq!(json2, "\"memory\"");
}

#[test]
fn test_enum_serde_command_type() {
    let json = serde_json::to_string(&CommandType::Action).unwrap();
    assert_eq!(json, "\"action\"");

    let parsed: CommandType = serde_json::from_str("\"metric\"").unwrap();
    assert!(matches!(parsed, CommandType::Metric));
}

#[test]
fn test_enum_serde_action_type() {
    let json = serde_json::to_string(&ActionType::GetCpuProfile).unwrap();
    assert_eq!(json, "\"get_cpu_profile\"");

    let parsed: ActionType = serde_json::from_str("\"get_memory_profile\"").unwrap();
    assert!(matches!(parsed, ActionType::GetMemoryProfile));
}

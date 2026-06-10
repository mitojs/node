use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex},
};

use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};

#[derive(Debug, Clone, Deserialize, Serialize, EnumString, Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum MetricType {
    Cpu,
    Memory,
    JsError,
    Timeout,
}

#[derive(Debug, Clone, Deserialize, Serialize, EnumString, Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ActionType {
    GetCpuProfile,
    GetMemoryProfile,
}

#[derive(Debug, Clone, Deserialize, Serialize, EnumString, Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum CommandType {
    Action,
    Metric,
}

pub struct CpuMetricData {
    load: f32,
    user_load: f32,
}

pub struct MemoryMetricData {
    memory: u64,
}

pub struct GetCpuProfileActionData {
    duration: i32,
    interval: i32,
}

pub struct GetMemoryProfileActionData {
    duration: i32,
}

// todo 约束 T 和 DataType 的关系

#[derive(Debug, Deserialize, Serialize)]
pub struct ProcessMetricInfo {
    pub process_id: u32,
    pub thread_id: Option<u16>,
    pub metric_type: MetricType,
    pub command_type: CommandType,
    // data: Box<T>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ProcessActionInfo {
    pub process_id: u32,
    pub thread_id: Option<u16>,
    pub action_type: ActionType,
    pub command_type: CommandType,
    // data: Box<T>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct BaseCommandData {
    pub command_type: CommandType,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessMetricSnapshot {
    pub metric_type: MetricType,
    pub data: serde_json::Value,
    pub recorded_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessStore {
    pub process_id: u32,
    pub proxy_port: Option<u16>,
    // timestamp second
    pub latest_heartbeat_time: u64,
    pub latest_metrics: Vec<ProcessMetricSnapshot>,
}

#[derive(Debug)]
pub struct PartialProcessStore {
    pub proxy_port: Option<u16>,
    // timestamp second
    pub latest_heartbeat_time: Option<u64>,
}

// 将数据存储改为静态变量，只对数据加锁
pub static PROCESS_DATA: LazyLock<Arc<Mutex<HashMap<u32, ProcessStore>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

#[derive(Debug)]
pub struct Store {
    data: Arc<Mutex<HashMap<u32, ProcessStore>>>,
}

impl Store {
    pub fn new() -> Self {
        Self {
            data: PROCESS_DATA.clone(),
        }
    }

    pub fn new_in_memory() -> Self {
        Self {
            data: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get_data(&self) -> std::sync::MutexGuard<HashMap<u32, ProcessStore>> {
        self.data.lock().unwrap()
    }

    pub fn set(&self, key: &u32, value: ProcessStore) -> () {
        self.data.lock().unwrap().insert(*key, value);
    }

    pub fn update(&self, key: &u32, value: PartialProcessStore) -> () {
        let mut data = self.data.lock().unwrap();
        let old = data.get(key);

        if let Some(old) = old {
            let new = ProcessStore {
                process_id: old.process_id,
                proxy_port: value.proxy_port.or(old.proxy_port),
                latest_heartbeat_time: value
                    .latest_heartbeat_time
                    .unwrap_or(old.latest_heartbeat_time),
                latest_metrics: old.latest_metrics.clone(),
            };
            data.insert(*key, new);
        }
        // 如果没有旧值，则不设置新值
    }

    pub fn get(&self, pid: &u32) -> Option<ProcessStore> {
        self.data.lock().unwrap().get(pid).cloned()
    }

    pub fn remove(&self, pid: &u32) -> Option<ProcessStore> {
        self.data.lock().unwrap().remove(pid)
    }

    pub fn register_process(&self, process_id: u32, proxy_port: Option<u16>, now: u64) {
        let mut data = self.data.lock().unwrap();
        let latest_metrics = data
            .get(&process_id)
            .map(|process| process.latest_metrics.clone())
            .unwrap_or_default();

        data.insert(
            process_id,
            ProcessStore {
                process_id,
                proxy_port,
                latest_heartbeat_time: now,
                latest_metrics,
            },
        );
    }

    pub fn record_metric(
        &self,
        process_id: u32,
        metric_type: MetricType,
        metric_data: serde_json::Value,
        now: u64,
    ) {
        let mut data = self.data.lock().unwrap();
        let process = data.entry(process_id).or_insert(ProcessStore {
            process_id,
            proxy_port: None,
            latest_heartbeat_time: now,
            latest_metrics: Vec::new(),
        });

        process.latest_heartbeat_time = now;
        process.latest_metrics.push(ProcessMetricSnapshot {
            metric_type,
            data: metric_data,
            recorded_at: now,
        });

        if process.latest_metrics.len() > 20 {
            process.latest_metrics.remove(0);
        }
    }

    pub fn list_processes(&self) -> Vec<ProcessStore> {
        let mut processes: Vec<ProcessStore> = self.data.lock().unwrap().values().cloned().collect();
        processes.sort_by_key(|process| process.process_id);
        processes
    }
}

pub static PROCESS_MAP_STORE: LazyLock<Store> = LazyLock::new(|| Store::new());

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn register_process_creates_queryable_process_state() {
        let store = Store::new_in_memory();

        store.register_process(12345, Some(16667), 100);

        let process = store.get(&12345).expect("process should exist");
        assert_eq!(process.process_id, 12345);
        assert_eq!(process.proxy_port, Some(16667));
        assert_eq!(process.latest_heartbeat_time, 100);
        assert!(process.latest_metrics.is_empty());
    }

    #[test]
    fn record_metric_upserts_process_and_keeps_latest_metric() {
        let store = Store::new_in_memory();

        store.record_metric(12345, MetricType::Memory, json!({ "rss": 100 }), 120);

        let process = store.get(&12345).expect("process should exist");
        assert_eq!(process.process_id, 12345);
        assert_eq!(process.latest_heartbeat_time, 120);
        assert_eq!(process.latest_metrics.len(), 1);
        assert!(matches!(process.latest_metrics[0].metric_type, MetricType::Memory));
        assert_eq!(process.latest_metrics[0].data, json!({ "rss": 100 }));
    }

    #[test]
    fn metric_type_accepts_exception_and_timeout_payload_names() {
        assert!(matches!(
            serde_json::from_str::<MetricType>("\"js_error\"").unwrap(),
            MetricType::JsError
        ));
        assert!(matches!(
            serde_json::from_str::<MetricType>("\"timeout\"").unwrap(),
            MetricType::Timeout
        ));
    }

    #[test]
    fn list_processes_returns_stable_pid_order() {
        let store = Store::new_in_memory();

        store.register_process(200, None, 1);
        store.register_process(100, None, 1);

        let pids: Vec<u32> = store
            .list_processes()
            .into_iter()
            .map(|process| process.process_id)
            .collect();

        assert_eq!(pids, vec![100, 200]);
    }
}

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};

#[derive(Debug, Deserialize, Serialize, EnumString, Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum MetricType {
    Cpu,
    Memory,
}

#[derive(Debug, Deserialize, Serialize, EnumString, Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ActionType {
    GetCpuProfile,
    GetMemoryProfile,
}

#[derive(Debug, Deserialize, Serialize, EnumString, Display)]
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
    pub thread_id: Option<u32>,
    pub metric_type: MetricType,
    pub command_type: CommandType,
    // data: Box<T>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ProcessActionInfo {
    pub process_id: u32,
    pub thread_id: Option<u32>,
    pub action_type: ActionType,
    pub command_type: CommandType,
    // data: Box<T>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct BaseCommandData {
    pub command_type: CommandType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessMetrics {
    pub cpu: Option<serde_json::Value>,
    pub memory: Option<serde_json::Value>,
    pub errors: Vec<serde_json::Value>,
    pub timers: Vec<serde_json::Value>,
    pub last_updated: u64,
}

impl ProcessMetrics {
    pub fn new() -> Self {
        Self {
            cpu: None,
            memory: None,
            errors: Vec::new(),
            timers: Vec::new(),
            last_updated: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProcessStore {
    pub uds_port: u16,
    // timestamp second
    pub latest_heartbeat_time: u64,
    pub metrics: ProcessMetrics,
}

#[derive(Debug)]
pub struct PartialProcessStore {
    pub uds_port: Option<u16>,
    // timestamp second
    pub latest_heartbeat_time: Option<u64>,
}

// 将数据存储改为静态变量，只对数据加锁
pub static PROCESS_DATA: LazyLock<Mutex<HashMap<u32, ProcessStore>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug)]
pub struct Store;

impl Store {
    pub fn new() -> Self {
        Self
    }

    pub fn get_data(&self) -> std::sync::MutexGuard<HashMap<u32, ProcessStore>> {
        PROCESS_DATA.lock().unwrap()
    }

    pub fn set(&self, key: &u32, value: ProcessStore) -> () {
        PROCESS_DATA.lock().unwrap().insert(*key, value);
    }

    pub fn update(&self, key: &u32, value: PartialProcessStore) -> () {
        let mut data = PROCESS_DATA.lock().unwrap();
        let old = data.get(key);

        if let Some(old) = old {
            let new = ProcessStore {
                uds_port: value.uds_port.unwrap_or(old.uds_port),
                latest_heartbeat_time: value
                    .latest_heartbeat_time
                    .unwrap_or(old.latest_heartbeat_time),
                metrics: old.metrics.clone(),
            };
            data.insert(*key, new);
        }
    }

    pub fn update_metrics(&self, pid: &u32, subject: &str, metric_data: serde_json::Value) {
        let mut data = PROCESS_DATA.lock().unwrap();
        let store = data.entry(*pid).or_insert_with(|| ProcessStore {
            uds_port: 0,
            latest_heartbeat_time: 0,
            metrics: ProcessMetrics::new(),
        });
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        store.metrics.last_updated = now;
        match subject {
            "cpu" | "CPU" => store.metrics.cpu = Some(metric_data),
            "memory" | "Memory" => store.metrics.memory = Some(metric_data),
            "js_error" | "JSError" => store.metrics.errors.push(metric_data),
            "timeout" | "Timeout" => store.metrics.timers.push(metric_data),
            _ => {}
        }
    }

    pub fn get_metrics(&self, pid: &u32) -> Option<ProcessMetrics> {
        PROCESS_DATA.lock().unwrap().get(pid).map(|s| s.metrics.clone())
    }

    pub fn get(&self, pid: &u32) -> Option<ProcessStore> {
        PROCESS_DATA.lock().unwrap().get(pid).cloned()
    }

    pub fn remove(&self, pid: &u32) -> Option<ProcessStore> {
        PROCESS_DATA.lock().unwrap().remove(pid)
    }

    /// 清理心跳超时的进程条目
    ///
    /// 移除 `latest_heartbeat_time` 距当前时间超过 `timeout_secs` 秒的所有条目。
    /// 心跳为 0 的条目（刚通过 update_metrics 自动创建但从未上报心跳）也会被清理。
    pub fn cleanup_expired(&self, timeout_secs: u64) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let mut data = PROCESS_DATA.lock().unwrap();
        data.retain(|_pid, store| {
            now.saturating_sub(store.latest_heartbeat_time) <= timeout_secs
        });
    }
}

pub static PROCESS_MAP_STORE: LazyLock<Store> = LazyLock::new(|| Store::new());

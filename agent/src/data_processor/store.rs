use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

use serde::{Deserialize, Serialize};
#[cfg(test)]
use strum::{Display, EnumString};

#[cfg(test)]
#[derive(Debug, Deserialize, Serialize, EnumString, Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum MetricType {
    Cpu,
    Memory,
}

#[cfg(test)]
#[derive(Debug, Deserialize, Serialize, EnumString, Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ActionType {
    GetCpuProfile,
    GetMemoryProfile,
}

#[cfg(test)]
#[derive(Debug, Deserialize, Serialize, EnumString, Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum CommandType {
    Action,
    Metric,
}

#[cfg(test)]
#[derive(Debug, Deserialize, Serialize)]
pub struct ProcessMetricInfo {
    pub process_id: u32,
    pub thread_id: Option<u32>,
    pub metric_type: MetricType,
    pub command_type: CommandType,
    // data: Box<T>,
}

#[cfg(test)]
#[derive(Debug, Deserialize, Serialize)]
pub struct ProcessActionInfo {
    pub process_id: u32,
    pub thread_id: Option<u32>,
    pub action_type: ActionType,
    pub command_type: CommandType,
    // data: Box<T>,
}

#[cfg(test)]
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct TruncatedMetrics {
    pub errors: u64,
    pub timers: u64,
}

#[derive(Debug, Clone)]
pub struct ProcessStore {
    pub uds_port: u16,
    // timestamp second
    pub latest_heartbeat_time: u64,
    pub metrics: ProcessMetrics,
    pub registered_subjects: Vec<String>,
    pub updated_at: HashMap<String, u64>,
    pub intervals: HashMap<String, u64>,
    pub truncated: TruncatedMetrics,
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

    pub fn get_data(&self) -> std::sync::MutexGuard<'_, HashMap<u32, ProcessStore>> {
        PROCESS_DATA.lock().unwrap()
    }

    #[cfg(test)]
    pub fn set(&self, key: &u32, value: ProcessStore) -> () {
        PROCESS_DATA.lock().unwrap().insert(*key, value);
    }

    pub fn update(&self, key: &u32, value: PartialProcessStore) -> () {
        let mut data = PROCESS_DATA.lock().unwrap();
        let old = data.get(key);

        if let Some(old) = old {
            let mut new = ProcessStore {
                uds_port: value.uds_port.unwrap_or(old.uds_port),
                latest_heartbeat_time: value
                    .latest_heartbeat_time
                    .unwrap_or(old.latest_heartbeat_time),
                metrics: old.metrics.clone(),
                registered_subjects: old.registered_subjects.clone(),
                updated_at: old.updated_at.clone(),
                intervals: old.intervals.clone(),
                truncated: old.truncated.clone(),
            };
            // 心跳证明错误监听仍存活，不伪造错误事件，也不修改历史事件时间。
            if value.latest_heartbeat_time.is_some()
                && new
                    .registered_subjects
                    .iter()
                    .any(|subject| subject == "JSError")
            {
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;
                new.updated_at.insert("JSError".to_string(), now_ms);
            }
            data.insert(*key, new);
        }
    }

    /// 只有显式注册的进程可以推送；迟到请求不能复活已注销的进程。
    pub fn update_metrics(&self, pid: &u32, subject: &str, metric_data: serde_json::Value) -> bool {
        let mut data = PROCESS_DATA.lock().unwrap();
        let Some(store) = data.get_mut(pid) else {
            return false;
        };
        let name = match subject {
            "cpu" | "CPU" => "CPU",
            "memory" | "Memory" => "Memory",
            "js_error" | "JSError" => "JSError",
            "timeout" | "Timeout" => "Timeout",
            _ => return false,
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        store.metrics.last_updated = now;
        store.updated_at.insert(name.to_string(), now);
        match name {
            "CPU" => store.metrics.cpu = Some(metric_data),
            "Memory" => store.metrics.memory = Some(metric_data),
            "JSError" => {
                store.metrics.errors.push(metric_data);
                if store.metrics.errors.len() > 100 {
                    store.metrics.errors.remove(0);
                    store.truncated.errors += 1;
                }
            }
            "Timeout" => {
                // 定时器是当前快照，空数组必须清空历史，不能追加形成嵌套数组。
                let timers = metric_data
                    .as_array()
                    .cloned()
                    .unwrap_or_else(|| vec![metric_data]);
                store.truncated.timers = timers.len().saturating_sub(1000) as u64;
                store.metrics.timers = timers.into_iter().take(1000).collect();
            }
            _ => unreachable!(),
        }
        true
    }

    #[cfg(test)]
    pub fn get_metrics(&self, pid: &u32) -> Option<ProcessMetrics> {
        PROCESS_DATA
            .lock()
            .unwrap()
            .get(pid)
            .map(|s| s.metrics.clone())
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
        data.retain(|_pid, store| now.saturating_sub(store.latest_heartbeat_time) <= timeout_secs);
    }
}

pub static PROCESS_MAP_STORE: LazyLock<Store> = LazyLock::new(|| Store::new());

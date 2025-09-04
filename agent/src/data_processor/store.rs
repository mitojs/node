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
    pub process_id: u16,
    pub thread_id: Option<u16>,
    pub metric_type: MetricType,
    pub command_type: CommandType,
    // data: Box<T>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ProcessActionInfo {
    pub process_id: u16,
    pub thread_id: Option<u16>,
    pub action_type: ActionType,
    pub command_type: CommandType,
    // data: Box<T>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct BaseCommandData {
    pub command_type: CommandType,
}

#[derive(Debug, Clone)]
pub struct ProcessStore {
    pub uds_port: u16,
    // timestamp second
    pub latest_heartbeat_time: u64,
}

#[derive(Debug)]
pub struct PartialProcessStore {
    pub uds_port: Option<u16>,
    // timestamp second
    pub latest_heartbeat_time: Option<u64>,
}

// 将数据存储改为静态变量，只对数据加锁
pub static PROCESS_DATA: LazyLock<Mutex<HashMap<u16, ProcessStore>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug)]
pub struct Store;

impl Store {
    pub fn new() -> Self {
        Self
    }

    pub fn get_data(&self) -> std::sync::MutexGuard<HashMap<u16, ProcessStore>> {
        PROCESS_DATA.lock().unwrap()
    }

    pub fn set(&self, key: &u16, value: ProcessStore) -> () {
        PROCESS_DATA.lock().unwrap().insert(*key, value);
    }

    pub fn update(&self, key: &u16, value: PartialProcessStore) -> () {
        let mut data = PROCESS_DATA.lock().unwrap();
        let old = data.get(key);

        if let Some(old) = old {
            let new = ProcessStore {
                uds_port: value.uds_port.unwrap_or(old.uds_port),
                latest_heartbeat_time: value
                    .latest_heartbeat_time
                    .unwrap_or(old.latest_heartbeat_time),
            };
            data.insert(*key, new);
        }
        // 如果没有旧值，则不设置新值
    }

    pub fn get(&self, pid: &u16) -> Option<ProcessStore> {
        PROCESS_DATA.lock().unwrap().get(pid).cloned()
    }

    pub fn remove(&self, pid: &u16) -> Option<ProcessStore> {
        PROCESS_DATA.lock().unwrap().remove(pid)
    }
}

pub static PROCESS_MAP_STORE: LazyLock<Store> = LazyLock::new(|| Store::new());

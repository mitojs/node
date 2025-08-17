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

// todo 约束 T 和 DataType 的关系

#[derive(Debug, Deserialize, Serialize)]
pub struct ProcessMetricInfo {
    pub process_id: String,
    pub thread_id: Option<String>,
    pub metric_type: MetricType,
    pub command_type: CommandType,
    // data: Box<T>,
}

pub struct ProcessActionInfo {
    pub process_id: String,
    pub thread_id: Option<String>,
    pub action_type: ActionType,
    pub command_type: CommandType,
    // data: Box<T>,
}

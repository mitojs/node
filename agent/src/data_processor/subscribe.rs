use std::sync::Arc;

use crate::{
    data_processor::store::{ActionType, BaseCommandData, CommandType, MetricType, ProcessActionInfo, ProcessMetricInfo},
    ipc::uds::DataCallback,
};

pub fn data_subscription() -> DataCallback {
    Arc::new(|data: &str| {
        println!("data_subscription接收到数据: {}", data);
        // 在这里可以添加更多的数据处理逻辑
        match serde_json::from_str::<BaseCommandData>(data) {
            Ok(json_data) => {
                match json_data.command_type {
                    CommandType::Metric => {
                        // 尝试解析为 ProcessMetricInfo
                        match serde_json::from_str::<ProcessMetricInfo>(data) {
                            Ok(metric_info) => handle_metric(metric_info),
                            Err(err) => println!("解析 Metric 数据失败: {:?}", err),
                        }
                    }
                    CommandType::Action => {
                        // 尝试解析为 ProcessActionInfo
                        match serde_json::from_str::<ProcessActionInfo>(data) {
                            Ok(action_info) => handle_action(action_info),
                            Err(err) => println!("解析 Action 数据失败: {:?}", err),
                        }
                    }
                }
            }
            Err(err) => {
                println!("序列化 JSON 数据失败 {},错误信息: {:?}", data, err);
            }
        }
    })
}

pub fn handle_metric(metric_info: ProcessMetricInfo) {
    match metric_info.metric_type {
        MetricType::Cpu => {
            println!("处理 CPU 指标: {:?}", metric_info);
            // TODO: 实现 CPU 指标处理逻辑
        }
        MetricType::Memory => {
            println!("处理 内存 指标: {:?}", metric_info);
            // TODO: 实现内存指标处理逻辑
        }
    }
}

pub fn handle_action(action_info: ProcessActionInfo) {
    match action_info.action_type {
        ActionType::GetCpuProfile => {
            println!("处理 CPU Profile 操作: {:?}", action_info);
            // TODO: 实现 CPU Profile 获取逻辑
        }
        ActionType::GetMemoryProfile => {
            println!("处理 Memory Profile 操作: {:?}", action_info);
            // TODO: 实现 Memory Profile 获取逻辑
        }
    }
}

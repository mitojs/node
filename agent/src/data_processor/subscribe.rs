use std::sync::Arc;

use crate::{
    data_processor::store::{BaseCommandData, CommandType, MetricType, ProcessMetricInfo},
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
                        println!("处理 Metric 指标");
                    }
                    CommandType::Action => {
                        println!("处理 Action 指标");
                    }
                }
                // 分发给不同的处理函数
                // todo Metric 下有区分 cpu、memory，action 下有区分 get_cpu_profile、get_memory_profile
            }
            Err(err) => {
                println!("序列化 JSON 数据失败 {},错误信息: {:?}", data, err);
            }
        }
    })
}

pub fn handle_metric(metric_type: ProcessMetricInfo) {
    match metric_type.metric_type {
        MetricType::Cpu => {
            println!("处理 CPU 指标: {:?}", metric_type);
            // 1. 和

            // 2.
        }
        MetricType::Memory => {
            println!("处理 内存 指标: {:?}", metric_type);
        }
    }
}

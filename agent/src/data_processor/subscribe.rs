use std::sync::Arc;

use crate::{data_processor::store::MetricType, ipc::uds::DataCallback};

pub fn uds_data_subscription() -> DataCallback {
    Arc::new(|data: &str| {
        println!("从UDS接收到数据: {}", data);
        // 在这里可以添加更多的数据处理逻辑
        // println!("d: {:?}");
        if let Ok(json_data) = serde_json::from_str::<MetricType>(data) {
            // 分发给不同的处理函数
            // todo 首先分为 Metric（获取）、action（执行）
            // todo Metric 下有区分 cpu、memory，action 下有区分 get_cpu_profile、get_memory_profile
            println!("json_data: {:?}", json_data);
        } else {
            println!("接收到非 JSON 数据 {}, 丢弃", data);
        }
    })
}

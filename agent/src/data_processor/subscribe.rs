use std::sync::Arc;

use crate::ipc::uds::DataCallback;

pub fn uds_data_subscription() -> DataCallback {
    Arc::new(|data: &str| {
        println!("从UDS接收到数据: {}", data);
        // 在这里可以添加更多的数据处理逻辑
        // 从 data 中获取 type 类型，分发给各个函数模块
        let json_data: serde_json::Value = serde_json::from_str(data).unwrap();
        println!("json_data: {:?}", json_data);
    })
}

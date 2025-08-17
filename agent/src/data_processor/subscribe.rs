use std::sync::Arc;

use crate::ipc::uds::DataCallback;

pub fn uds_data_subscription() -> DataCallback {
    Arc::new(|data: &str| {
        println!("从UDS接收到数据: {}", data);
        // 在这里可以添加更多的数据处理逻辑
    })
}

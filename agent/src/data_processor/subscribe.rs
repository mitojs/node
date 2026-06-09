use std::sync::Arc;

use crate::{
    data_processor::store::{
        ActionType, BaseCommandData, CommandType, MetricType, ProcessActionInfo, ProcessMetricInfo,
    },
    ipc::tcp::DataCallback,
    {error_print, log_print},
};

/// 监听 UDS 的数据通信回调
pub fn data_subscription() -> DataCallback {
    Arc::new(|data: &str| {
        if data.trim().is_empty() {
            return;
        }

        log_print!("📥 接收到数据: {}", data);

        match process_data(data) {
            Ok(_) => log_print!("✅ 数据处理成功"),
            Err(e) => error_print!("❌ 数据处理失败: {}", e),
        }
    })
}

fn process_data(data: &str) -> Result<(), String> {
    // 首先尝试解析基础命令数据
    let base_data: BaseCommandData =
        serde_json::from_str(data).map_err(|e| format!("解析基础命令数据失败: {}", e))?;

    match base_data.command_type {
        CommandType::Metric => {
            let metric_info: ProcessMetricInfo =
                serde_json::from_str(data).map_err(|e| format!("解析指标数据失败: {}", e))?;
            handle_metric(metric_info)
        }
        CommandType::Action => {
            let action_info: ProcessActionInfo =
                serde_json::from_str(data).map_err(|e| format!("解析操作数据失败: {}", e))?;
            handle_action(action_info)
        }
    }
}

fn handle_metric(metric_info: ProcessMetricInfo) -> Result<(), String> {
    log_print!("📊 处理指标数据: {:?}", metric_info);

    match metric_info.metric_type {
        MetricType::Cpu => {
            log_print!("🖥️  处理 CPU 指标");
            // TODO: 实现 CPU 指标处理逻辑
            Ok(())
        }
        MetricType::Memory => {
            log_print!("🧠 处理内存指标");
            // TODO: 实现内存指标处理逻辑
            Ok(())
        }
    }
}

fn handle_action(action_info: ProcessActionInfo) -> Result<(), String> {
    log_print!("⚡ 处理操作数据: {:?}", action_info);

    match action_info.action_type {
        ActionType::GetCpuProfile => {
            log_print!("🖥️  获取 CPU Profile");
            // TODO: 实现 CPU Profile 获取逻辑
            Ok(())
        }
        ActionType::GetMemoryProfile => {
            log_print!("🧠 获取 Memory Profile");
            // TODO: 实现 Memory Profile 获取逻辑
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_data_metric() {
        let json = r#"{"command_type":"metric","process_id":1,"metric_type":"cpu"}"#;
        assert!(process_data(json).is_ok());
    }

    #[test]
    fn test_process_data_action() {
        let json = r#"{"command_type":"action","process_id":1,"action_type":"get_cpu_profile"}"#;
        assert!(process_data(json).is_ok());
    }

    #[test]
    fn test_process_data_invalid_json() {
        assert!(process_data("not json at all").is_err());
    }

    #[test]
    fn test_process_data_missing_command_type() {
        let json = r#"{"process_id":1}"#;
        assert!(process_data(json).is_err());
    }
}

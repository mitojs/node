use std::sync::Arc;

use crate::{
    data_processor::store::{
        ActionType, BaseCommandData, CommandType, MetricType, ProcessActionInfo, ProcessMetricInfo,
        PROCESS_MAP_STORE,
    },
    ipc::tcp::DataCallback,
    {error_print, log_print},
};

/// UDS/TCP 数据格式：包含指标值的完整消息
#[derive(Debug, serde::Deserialize)]
struct MetricMessage {
    process_id: u32,
    metric_type: MetricType,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

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
    let base_data: BaseCommandData =
        serde_json::from_str(data).map_err(|e| format!("解析基础命令数据失败: {}", e))?;

    match base_data.command_type {
        CommandType::Metric => {
            let metric_info: ProcessMetricInfo =
                serde_json::from_str(data).map_err(|e| format!("解析指标数据失败: {}", e))?;
            handle_metric(metric_info, data)
        }
        CommandType::Action => {
            let action_info: ProcessActionInfo =
                serde_json::from_str(data).map_err(|e| format!("解析操作数据失败: {}", e))?;
            handle_action(action_info)
        }
    }
}

fn handle_metric(metric_info: ProcessMetricInfo, raw_data: &str) -> Result<(), String> {
    log_print!("📊 处理指标数据: {:?}", metric_info);

    // 从原始 JSON 中提取 data 字段写入 Store
    let msg: MetricMessage =
        serde_json::from_str(raw_data).map_err(|e| format!("解析指标消息失败: {}", e))?;

    let subject = match metric_info.metric_type {
        MetricType::Cpu => "CPU",
        MetricType::Memory => "Memory",
    };

    let metric_data = msg.data.unwrap_or(serde_json::Value::Null);
    PROCESS_MAP_STORE.update_metrics(&metric_info.process_id, subject, metric_data);

    log_print!(
        "✅ 指标已写入 Store: pid={}, subject={}",
        metric_info.process_id,
        subject
    );
    Ok(())
}

fn handle_action(action_info: ProcessActionInfo) -> Result<(), String> {
    log_print!("⚡ 处理操作数据: {:?}", action_info);

    match action_info.action_type {
        ActionType::GetCpuProfile => {
            log_print!(
                "🖥️  收到 CPU Profile 请求: pid={}",
                action_info.process_id
            );
            // TODO: 向对应进程的 Worker Thread 代理发送采集指令
            Ok(())
        }
        ActionType::GetMemoryProfile => {
            log_print!(
                "🧠 收到 Memory Profile 请求: pid={}",
                action_info.process_id
            );
            // TODO: 向对应进程的 Worker Thread 代理发送采集指令
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    use crate::data_processor::store::PROCESS_DATA;

    fn clear_store() {
        PROCESS_DATA.lock().unwrap().clear();
    }

    #[test]
    #[serial]
    fn test_process_data_metric() {
        clear_store();
        let json = r#"{"command_type":"metric","process_id":1,"metric_type":"cpu"}"#;
        assert!(process_data(json).is_ok());
    }

    #[test]
    #[serial]
    fn test_process_data_metric_with_data() {
        clear_store();
        let json =
            r#"{"command_type":"metric","process_id":42,"metric_type":"cpu","data":{"load":55.2}}"#;
        assert!(process_data(json).is_ok());
        // 验证数据已写入 Store
        let metrics = PROCESS_MAP_STORE.get_metrics(&42);
        assert!(metrics.is_some());
        assert!(metrics.unwrap().cpu.is_some());
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

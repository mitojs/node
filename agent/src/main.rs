mod data_processor;
mod helper;
mod ipc;
#[macro_use]
mod marco;

use crate::data_processor::store::PROCESS_MAP_STORE;
use crate::helper::config::AppConfig;
use crate::ipc::http;
use tokio::signal;

// 手动启动的 daemon 持续运行；SDK 创建的 daemon 才在最后一个客户端离开后退出。
fn idle_exit_due(managed: bool, empty_since: Option<u64>, now: u64) -> bool {
    managed && empty_since.is_some_and(|since| now.saturating_sub(since) >= 30)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = AppConfig::new();
    config
        .validate()
        .map_err(|e| format!("配置验证失败: {}", e))?;
    config.print_config();
    http::http::start_http_server(config).await?;
    let managed = std::env::var("MITO_AGENT_MANAGED").is_ok_and(|value| value == "1");
    let started = std::time::Instant::now();
    let mut empty_since = Some(0);
    let mut ticks = tokio::time::interval(std::time::Duration::from_secs(1));
    let mut last_cleanup = 0;
    loop {
        tokio::select! {
            _ = signal::ctrl_c() => break,
            _ = ticks.tick() => {
                let now = started.elapsed().as_secs();
                if now.saturating_sub(last_cleanup) >= 60 {
                    PROCESS_MAP_STORE.cleanup_expired(300);
                    last_cleanup = now;
                }
                if PROCESS_MAP_STORE.get_data().is_empty() {
                    let since = empty_since.get_or_insert(now);
                    if idle_exit_due(managed, Some(*since), now) { break; }
                } else { empty_since = None; }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod lifecycle_tests {
    #[test]
    fn managed_daemon_exits_only_after_thirty_empty_seconds() {
        assert!(!super::idle_exit_due(false, Some(0), 100));
        assert!(!super::idle_exit_due(true, None, 100));
        assert!(!super::idle_exit_due(true, Some(10), 39));
        assert!(super::idle_exit_due(true, Some(10), 40));
    }
}

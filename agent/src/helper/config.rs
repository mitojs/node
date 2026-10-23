use crate::{
    debug_print,
    helper::constants::{AGENT_DIR, AGENT_TCP_PORT},
    log_print,
};
/// 应用程序配置
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub tcp: TcpConfig,
    pub agent_dir: String,
}

/// TCP 服务器配置
#[derive(Debug, Clone)]
pub struct TcpConfig {
    pub port: u16,
    pub host: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            tcp: TcpConfig::default(),
            agent_dir: "".to_string(),
        }
    }
}

impl Default for TcpConfig {
    fn default() -> Self {
        Self {
            port: AGENT_TCP_PORT,
            host: "127.0.0.1".to_string(),
        }
    }
}

impl AppConfig {
    /// 从环境变量加载配置
    pub fn new() -> Self {
        let mut config = Self::default();

        // 从环境变量加载 TCP 端口
        if let Ok(port) = std::env::var("MITO_AGENT_TCP_PORT") {
            if let Ok(port_num) = port.parse::<u16>() {
                debug_print!("ENV MITO_AGENT_TCP_PORT: {}", port_num);
                config.tcp.port = port_num;
            }
        }
        if let Ok(host) = std::env::var("MITO_AGENT_HOST") {
            config.tcp.host = host;
        }

        // todo 在当前目录下创建 agent 目录，如果不行则在 tmp 下创建目录
        config.agent_dir = std::env::current_dir()
            .unwrap()
            .join(AGENT_DIR)
            .to_string_lossy()
            .to_string();

        config
    }

    /// 验证配置的有效性
    pub fn validate(&self) -> Result<(), String> {
        if self.tcp.port == 0 {
            return Err("TCP 端口不能为 0".to_string());
        }

        // Agent 具备采集数据和进程控制能力，只允许回环地址。
        if !["127.0.0.1", "localhost", "::1"].contains(&self.tcp.host.as_str()) {
            return Err("Agent 只允许监听本机回环地址".into());
        }
        Ok(())
    }

    /// 打印配置信息
    pub fn print_config(&self) {
        log_print!("📋 应用程序配置:");
        log_print!("    地址: {}:{}", self.tcp.host, self.tcp.port);
    }
}

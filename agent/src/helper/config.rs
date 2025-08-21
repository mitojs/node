use std::time::Duration;

use crate::helper::constants::AGENT_TCP_PORT;

/// 应用程序配置
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub tcp: TcpConfig,
}

/// TCP 服务器配置
#[derive(Debug, Clone)]
pub struct TcpConfig {
    pub port: u16,
    pub host: String,
    pub connection_timeout: Duration,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            tcp: TcpConfig::default(),
        }
    }
}

impl Default for TcpConfig {
    fn default() -> Self {
        Self {
            port: AGENT_TCP_PORT,
            host: "localhost".to_string(),
            connection_timeout: Duration::from_secs(30),
        }
    }
}

impl AppConfig {
    /// 从环境变量加载配置
    pub fn from_env() -> Self {
        let mut config = Self::default();

        // TCP 配置
        if let Ok(port) = std::env::var("AGENT_TCP_PORT") {
            if let Ok(port_num) = port.parse::<u16>() {
                config.tcp.port = port_num;
            }
        }

        if let Ok(host) = std::env::var("AGENT_HOST") {
            config.tcp.host = host;
        }



        config
    }

    /// 验证配置的有效性
    pub fn validate(&self) -> Result<(), String> {
        if self.tcp.port == 0 {
            return Err("TCP 端口不能为 0".to_string());
        }

        Ok(())
    }

    /// 打印配置信息
    pub fn print_config(&self) {
        println!("📋 应用程序配置:");
        println!("  TCP 服务器:");
        println!("    地址: {}:{}", self.tcp.host, self.tcp.port);
        println!("    连接超时: {:?}", self.tcp.connection_timeout);
        println!("  服务器:");
    }
}

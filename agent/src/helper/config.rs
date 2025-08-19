use std::time::Duration;

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
    pub heartbeat_interval: Duration,
    pub max_connections: usize,
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
            port: 12345,
            host: "127.0.0.1".to_string(),
            heartbeat_interval: Duration::from_secs(5),
            max_connections: 100,
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

        if let Ok(max_conn) = std::env::var("AGENT_MAX_CONNECTIONS") {
            if let Ok(max_conn_num) = max_conn.parse::<usize>() {
                config.tcp.max_connections = max_conn_num;
            }
        }

        if let Ok(heartbeat) = std::env::var("AGENT_HEARTBEAT_INTERVAL") {
            if let Ok(heartbeat_secs) = heartbeat.parse::<u64>() {
                config.tcp.heartbeat_interval = Duration::from_secs(heartbeat_secs);
            }
        }

        config
    }

    /// 验证配置的有效性
    pub fn validate(&self) -> Result<(), String> {
        if self.tcp.port == 0 {
            return Err("TCP 端口不能为 0".to_string());
        }

        if self.tcp.max_connections == 0 {
            return Err("最大连接数不能为 0".to_string());
        }

        Ok(())
    }

    /// 打印配置信息
    pub fn print_config(&self) {
        println!("📋 应用程序配置:");
        println!("  TCP 服务器:");
        println!("    地址: {}:{}", self.tcp.host, self.tcp.port);
        println!("    最大连接数: {}", self.tcp.max_connections);
        println!("    心跳间隔: {:?}", self.tcp.heartbeat_interval);
        println!("    连接超时: {:?}", self.tcp.connection_timeout);
        println!("  服务器:");
    }
}

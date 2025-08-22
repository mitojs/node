use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::task;
use tokio::time::interval;

// 导入宏
use crate::{log_print, debug_print, error_print};

// 定义回调函数类型
pub type DataCallback = Arc<dyn Fn(&str) + Send + Sync>;

// 服务器配置
#[derive(Debug, Clone)]
pub struct TcpConfig {
    pub port: u16,
    pub host: String,
}

impl Default for TcpConfig {
    fn default() -> Self {
        Self {
            port: 12345,
            host: "127.0.0.1".to_string(),
        }
    }
}

pub struct TcpSocket {
    pub listener: TcpListener,
    pub config: TcpConfig,
}

impl TcpSocket {
    pub async fn new(port: u16) -> Result<Self, std::io::Error> {
        let config = TcpConfig {
            port,
            ..Default::default()
        };
        Self::with_config(config).await
    }

    pub async fn with_config(config: TcpConfig) -> Result<Self, std::io::Error> {
        let addr = format!("{}:{}", config.host, config.port);
        let listener = TcpListener::bind(&addr).await?;
        log_print!("✅ TCP socket 绑定成功，监听地址: {}", addr);
        Ok(TcpSocket { listener, config })
    }

    pub async fn set_callback(self, callback: DataCallback) {
        log_print!("🔄 TCP socket 设置回调成功");

        // 使用 tokio::spawn 在后台处理连接
        let config = self.config.clone();
        task::spawn(async move {
            let mut connection_count = 0;

            loop {
                match self.listener.accept().await {
                    Ok((stream, addr)) => {
                        connection_count += 1;
                        log_print!(
                            "🔗 接受新连接: {} (当前连接数: {})",
                            addr,
                            connection_count
                        );

                        // 为每个连接创建一个处理任务
                        let callback_for_task = callback.clone();
                        let config_for_task = config.clone();

                        task::spawn(async move {
                            handle_client_with_heartbeat(
                                stream,
                                callback_for_task,
                                config_for_task,
                            )
                            .await;
                            connection_count -= 1;
                            log_print!("🔌 连接关闭，当前连接数: {}", connection_count);
                        });
                    }
                    Err(e) => {
                        error_print!("接受连接时发生错误: {}", e);
                        break;
                    }
                }
            }
        });
    }
}

// 处理客户端连接并定时发送心跳的异步函数
async fn handle_client_with_heartbeat(
    stream: TcpStream,
    callback: DataCallback,
    config: TcpConfig,
) {
    let (reader, writer) = stream.into_split();

    // 创建心跳任务
    let heartbeat_task = task::spawn(async move {
        handle_heartbeat_writer(writer, Duration::from_secs(5)).await;
    });

    // 创建数据读取任务
    let read_task = task::spawn(async move {
        handle_client_reader(reader, callback).await;
    });

    // 等待任一任务完成
    tokio::select! {
        _ = heartbeat_task => {
            log_print!("💓 心跳任务结束");
        }
        _ = read_task => {
            log_print!("📖 读取任务结束");
        }
    }
}

// 处理客户端数据读取的异步函数
async fn handle_client_reader(reader: tokio::net::tcp::OwnedReadHalf, callback: DataCallback) {
    let mut buf_reader = BufReader::new(reader);
    let mut buffer = String::new();

    loop {
        buffer.clear();
        match buf_reader.read_line(&mut buffer).await {
            Ok(0) => {
                log_print!("🔌 客户端连接已关闭");
                break;
            }
            Ok(_size) => {
                let data = buffer.trim();
                if !data.is_empty() {
                    callback(data);
                }
            }
            Err(e) => {
                error_print!("读取数据时发生错误: {}", e);
                break;
            }
        }
    }
}

// 定时发送心跳的异步函数
async fn handle_heartbeat_writer(
    mut writer: tokio::net::tcp::OwnedWriteHalf,
    interval_duration: Duration,
) {
    let mut interval = interval(interval_duration);
    let mut counter = 0;

    loop {
        interval.tick().await;
        counter += 1;

        let message = format!(
            "💓 Heartbeat #{}: {}\n",
            counter,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        );

        if let Err(e) = writer.write_all(message.as_bytes()).await {
            error_print!("发送心跳失败: {}", e);
            break;
        }

        if let Err(e) = writer.flush().await {
            error_print!("刷新流失败: {}", e);
            break;
        }
    }
}

use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::task;
use tokio::time::interval;

// 定义回调函数类型
// 一定要加 dyn，
pub type DataCallback = Arc<dyn Fn(&str) + Send + Sync>;

pub struct TcpSocket {
    pub listener: TcpListener,
    pub port: u16,
}

impl TcpSocket {
    pub async fn new(port: u16) -> Result<Self, std::io::Error> {
        let addr = format!("127.0.0.1:{}", port);
        let listener = TcpListener::bind(&addr).await?;
        println!("TCP socket Bind 成功，监听地址: {}", addr);
        Ok(TcpSocket { listener, port })
    }

    pub async fn set_callback(self, callback: DataCallback) {
        println!("TCP socket set_callback 成功");

        // 使用 tokio::spawn 在后台处理连接
        task::spawn(async move {
            loop {
                match self.listener.accept().await {
                    Ok((stream, addr)) => {
                        // 新 client 链接，创建新的任务处理
                        println!("Accepted connection from: {}", addr);

                        // 为每个连接创建一个处理任务，每个链接可能是在独立的线程中处理
                        let callback_for_independent_task = callback.clone();

                        task::spawn(async move {
                            handle_client_with_heartbeat(stream, callback_for_independent_task)
                                .await;
                        });
                    }
                    Err(e) => {
                        eprintln!("Error accepting connection: {}", e);
                        break;
                    }
                }
            }
        });
    }
}

// 处理客户端连接的异步函数
async fn handle_client(mut stream: TcpStream, callback: DataCallback) {
    let mut buf_reader = BufReader::new(&mut stream);
    let mut buffer = String::new();

    loop {
        buffer.clear();
        // 在接收 换行符 触发回调
        match buf_reader.read_line(&mut buffer).await {
            Ok(0) => {
                println!("客户端连接已关闭");
                break;
            }
            Ok(_size) => {
                // 成功读取数据，调用回调函数处理数据
                callback(buffer.trim());
            }
            Err(e) => {
                eprintln!("读取数据时发生错误: {}", e);
                break;
            }
        }
    }
}

// 定时每5秒写数据的异步函数
async fn handle_heartbeat_writer(mut writer: tokio::net::tcp::OwnedWriteHalf) {
    let mut interval = interval(Duration::from_secs(5));
    let mut counter = 0;
    loop {
        interval.tick().await;
        counter += 1;
        let message = format!(
            "Heartbeat #{}: {}\n",
            counter,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        );
        if let Err(e) = writer.write_all(message.as_bytes()).await {
            eprintln!("Failed to write heartbeat: {}", e);
            break;
        }
        if let Err(e) = writer.flush().await {
            eprintln!("Failed to flush stream: {}", e);
            break;
        }
    }
}

// 处理客户端连接并定时每5秒写数据的异步函数
async fn handle_client_with_heartbeat(stream: TcpStream, callback: DataCallback) {
    let (reader, writer) = stream.into_split();

    // 创建定时器任务，每5秒写一次数据
    let heartbeat_task = task::spawn(async move {
        handle_heartbeat_writer(writer).await;
    });

    // 使用原有的handle_client函数处理数据读取
    let read_task = task::spawn(async move {
        handle_client_reader(reader, callback).await;
    });

    // 等待两个任务都完成
    let _ = tokio::join!(heartbeat_task, read_task);
    println!("Client connection closed");
}

// 处理客户端数据读取的异步函数（从原有handle_client函数分离出来）
async fn handle_client_reader(reader: tokio::net::tcp::OwnedReadHalf, callback: DataCallback) {
    let mut buf_reader = BufReader::new(reader);
    let mut buffer = String::new();

    loop {
        buffer.clear();
        // 在接收 换行符 触发回调
        match buf_reader.read_line(&mut buffer).await {
            Ok(0) => {
                println!("客户端连接已关闭");
                break;
            }
            Ok(_size) => {
                // 成功读取数据，调用回调函数处理数据
                callback(buffer.trim());
            }
            Err(e) => {
                eprintln!("读取数据时发生错误: {}", e);
                break;
            }
        }
    }
}

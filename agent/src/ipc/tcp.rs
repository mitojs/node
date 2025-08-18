use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::task;

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
        println!("TCP socket set_callback 成功，端口: {}", self.port);

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
                            handle_client(stream, callback_for_independent_task).await;
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

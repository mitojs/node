use crate::helper::constants::UDS_SOCKET_NAME;
use crate::helper::path::get_tmp_path;
use serde_json::Value;
use std::fs;
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::net::UnixStream;
use tokio::task;

pub struct UdsSocket {
    listener: UnixListener,
    socket_path: PathBuf,
}

impl UdsSocket {
    pub fn new() -> Result<Self, std::io::Error> {
        // 调用 utils::path 模块的 get_tmp_path 函数获取临时路径
        let tmp_path = get_tmp_path();
        let socket_path = Path::new(&tmp_path).join(UDS_SOCKET_NAME);
        println!("socket_path: {:?}", socket_path);

        // 如果 socket 文件已存在，先删除它
        if socket_path.exists() {
            fs::remove_file(&socket_path)?;
        }

        let listener = UnixListener::bind(&socket_path)?;

        // 设置为非阻塞模式
        listener.set_nonblocking(true)?;

        // 克隆 listener 用于异步任务
        let listener_clone = listener.try_clone()?;

        // 使用 tokio::spawn 在后台处理连接
        task::spawn(async move {
            loop {
                match listener_clone.accept() {
                    Ok((stream, _addr)) => {
                        // 新 client 链接，创建新的任务处理
                        println!("Accepted connection from: {:?}, {:?}", stream, _addr);

                        // 将 std::os::unix::net::UnixStream 转换为 tokio::net::UnixStream
                        stream.set_nonblocking(true).unwrap();
                        let tokio_stream = UnixStream::from_std(stream).unwrap();

                        // 为每个连接创建一个处理任务
                        task::spawn(async move {
                            handle_client(tokio_stream).await;
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // 非阻塞模式下没有连接时会返回 WouldBlock，等待一下再继续
                        println!("WouldBlock, sleep 10ms");
                        tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;
                    }
                    Err(e) => {
                        eprintln!("Error accepting connection: {}", e);
                        break;
                    }
                }
            }
        });

        println!("UDS socket 创建成功，连接监听已在后台启动");
        Ok(UdsSocket {
            listener,
            socket_path,
        })
    }

    pub fn listener(&self) -> &UnixListener {
        &self.listener
    }
}

// 处理客户端连接的异步函数
async fn handle_client(mut stream: UnixStream) {
    let mut buf_reader = BufReader::new(&mut stream);
    let mut buffer = String::new();

    loop {
        buffer.clear();
        // 在换行时读取数据
        match buf_reader.read_line(&mut buffer).await {
            Ok(0) => {
                // 连接关闭
                println!("客户端连接已关闭");
                break;
            }
            Ok(n) => {
                // 成功读取数据
                let received_data = buffer.trim();
                println!(
                    "接收到数据 ({} 字节): {:?}",
                    n,
                    serde_json::from_str::<serde_json::Value>(received_data).unwrap()
                );

                // 这里可以添加数据处理逻辑
                process_received_data(received_data).await;
            }
            Err(e) => {
                eprintln!("读取数据时发生错误: {}", e);
                break;
            }
        }
    }
}

// 处理接收到的数据
async fn process_received_data(data: &str) {
    println!("处理数据: {}", data);

    // 这里可以根据需要添加具体的数据处理逻辑
    // 例如：解析JSON、执行命令、存储数据等
    match data {
        "ping" => println!("收到ping，回复pong"),
        "status" => println!("系统状态正常"),
        _ => println!("未知命令: {}", data),
    }
}

impl Drop for UdsSocket {
    fn drop(&mut self) {
        // 在进程关闭时自动移除 socket 文件
        if self.socket_path.exists() {
            let _ = fs::remove_file(&self.socket_path);
            println!("UDS socket 文件已移除");
        }
    }
}

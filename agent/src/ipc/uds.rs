use std::fs;
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::UnixStream;
use tokio::task;

// 定义回调函数类型
// 一定要加 dyn，
pub type DataCallback = Arc<dyn Fn(&str) + Send + Sync>;

// pub trait UdsSocketTrait {
//     fn set_callback(self, callback: DataCallback);
// }

pub struct UdsSocket {
    pub listener: UnixListener,
    pub socket_path: PathBuf,
}

impl UdsSocket {
    pub fn new(socket_path: PathBuf) -> Result<Self, std::io::Error> {
        // 如果 socket 文件已存在，先删除它
        if socket_path.exists() {
            fs::remove_file(&socket_path)?;
        }

        let listener = UnixListener::bind(&socket_path)?;
        // 设置为非阻塞模式
        listener.set_nonblocking(true)?;
        println!("UDS socket Bind 成功，socket_path: {:?}", socket_path);
        Ok(UdsSocket {
            listener,
            socket_path,
        })
    }

    pub fn set_callback(&self, callback: DataCallback) {
        let listener_clone = self.listener.try_clone().unwrap();
        println!(
            "UDS socket set_callback 成功，socket_path: {:?}",
            self.socket_path
        );
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

                        // 为每个连接创建一个处理任务，每个链接可能是在独立的线程中处理
                        let callback_for_independent_task = callback.clone();
                        task::spawn(async move {
                            handle_client(tokio_stream, callback_for_independent_task).await;
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
    }
}

// 处理客户端连接的异步函数
async fn handle_client(mut stream: UnixStream, callback: DataCallback) {
    let mut buf_reader = BufReader::new(&mut stream);
    let mut buffer = String::new();

    loop {
        buffer.clear();
        // 在接收 换行符 触发回调
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

                // 调用回调函数处理数据
                callback(received_data);
            }
            Err(e) => {
                eprintln!("读取数据时发生错误: {}", e);
                break;
            }
        }
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

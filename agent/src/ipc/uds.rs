use crate::helper::constants::UDS_SOCKET_NAME;
use crate::helper::path::get_tmp_path;
use std::fs;
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
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
                        println!("Accepted connection from: {:?}", stream);
                        // 这里可以进一步处理连接
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // 非阻塞模式下没有连接时会返回 WouldBlock，等待一下再继续
                        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
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

impl Drop for UdsSocket {
    fn drop(&mut self) {
        // 在进程关闭时自动移除 socket 文件
        if self.socket_path.exists() {
            let _ = fs::remove_file(&self.socket_path);
            println!("UDS socket 文件已移除");
        }
    }
}

// 引入模块
mod data_processor;
mod helper;
mod ipc;
mod marco;

use crate::ipc::uds::UdsSocket;

#[tokio::main]
async fn main() {
    println!("Agent 启动中...");

    let _uds_socket = match UdsSocket::new() {
        Ok(socket) => socket,
        Err(e) => {
            eprintln!("创建 UDS socket 失败: {}", e);
            return;
        }
    };
    // socket 会在 _uds_socket 离开作用域时自动清理
    println!("UDS socket 创建成功，进程结束时将自动清理");
    
    // 保持程序运行，让异步任务有时间执行
    println!("程序将运行 10 秒来演示异步监听...");
    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
    println!("程序即将退出，socket 将自动清理");
}

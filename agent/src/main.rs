// 引入模块
mod data_processor;
mod helper;
mod ipc;
mod marco;

use tokio::signal;

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
    signal::ctrl_c().await.expect("failed to listen for event");
    // tokio::time::sleep(tokio::time::Duration::from_secs(1000000000)).await;
    println!("程序即将退出，socket 将自动清理");
}

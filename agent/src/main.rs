// 引入模块
mod data_processor;
mod helper;
mod ipc;
mod marco;

use tokio::signal;

// 用 crate:: 会优先从顶层 crate（如 binary crate 的 main.rs），或模块内直接引用同级或下级模块
use crate::data_processor::subscribe::data_subscription;

#[tokio::main]
async fn main() {
    println!("Agent 启动中...");
    // let socket_path = helper::path::get_socket_path();

    // let uds_socket = match UdsSocket::new(socket_path) {
    //     Ok(socket) => socket,
    //     Err(e) => {
    //         eprintln!("创建 UDS socket 失败: {}", e);
    //         return;
    //     }
    // };
    // uds_socket.set_callback(data_subscription());

    let tcp_socket = match ipc::tcp::TcpSocket::new(12345).await {
        Ok(socket) => socket,
        Err(e) => {
            eprintln!("创建 TCP socket 失败: {}", e);
            return;
        }
    };
    tcp_socket.set_callback(data_subscription()).await;
    // 保持程序运行，让异步任务有时间执行，只有在 ctrl + c 时才终止
    signal::ctrl_c().await.expect("failed to listen for event");
}

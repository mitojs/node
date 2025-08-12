// 引入模块
mod data_processor;
mod helper;
mod ipc;
mod marco;

use crate::ipc::uds::create_uds_socket;

fn main() {
    println!("Agent 启动中...");

    let uds_socket = match create_uds_socket() {
        Ok(socket) => socket,
        Err(e) => {
            eprintln!("创建 UDS socket 失败: {}", e);
            return;
        }
    };
}

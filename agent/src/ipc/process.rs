use std::fs::OpenOptions;
use std::io::{self, Write};

use crate::error_print;
use crate::helper::constants::IpcMessageCode;

#[derive(Debug, serde::Serialize)]
pub struct IpcMessage {
    pub code: IpcMessageCode,
    pub message: String,
}

#[cfg(target_os = "macos")]
fn get_ipc_path() -> &'static str {
    "/dev/fd/3"
}

#[cfg(target_os = "linux")]
fn get_ipc_path() -> &'static str {
    "/proc/self/fd/3"
}

pub fn write_message_for_ipc(message: IpcMessage) -> io::Result<()> {
    let message = serde_json::to_string(&message)?;
    let mut file = OpenOptions::new().write(true).open(get_ipc_path())?;
    writeln!(file, "{}", message)?;
    file.flush()?;
    // 不要让 file 被 drop，否则会关闭文件描述符
    std::mem::forget(file);
    Ok(())
}

pub fn send_ipc_message(message: IpcMessage) {
    if let Err(_) = write_message_for_ipc(message) {
        error_print!("write message for ipc failed");
        // std::process::exit(1);
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::helper::constants::IpcMessageCode;

    #[test]
    fn test_ipc_message_serialize() {
        let msg = IpcMessage {
            code: IpcMessageCode::Ok,
            message: "success".to_string(),
        };
        let json: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["code"], 200);
        assert_eq!(json["message"], "success");

        let msg_err = IpcMessage {
            code: IpcMessageCode::Err,
            message: "failed".to_string(),
        };
        let json_err: serde_json::Value = serde_json::to_value(&msg_err).unwrap();
        assert_eq!(json_err["code"], 500);
        assert_eq!(json_err["message"], "failed");
    }

    #[test]
    fn test_get_ipc_path() {
        let path = get_ipc_path();
        assert!(!path.is_empty());
        // macOS: /dev/fd/3, Linux: /proc/self/fd/3
        assert!(path.contains("fd/3"));
    }
}

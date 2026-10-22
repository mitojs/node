use std::io::{self, Write};

use crate::error_print;
use crate::helper::constants::IpcMessageCode;

#[derive(Debug, serde::Serialize)]
pub struct IpcMessage {
    pub code: IpcMessageCode,
    pub message: String,
}

/// Windows 不支持 /dev/fd/3 或 /proc/self/fd/3，使用 stdout 作为 IPC 通道的回退方案
#[cfg(target_os = "windows")]
fn write_message_for_ipc(message: IpcMessage) -> io::Result<()> {
    let message = serde_json::to_string(&message)?;
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "{}", message)?;
    stdout.flush()?;
    Ok(())
}

/// 直接复制继承的 socket FD，避免 Linux 将 /proc/self/fd 路径重新 open 时失败。
#[cfg(unix)]
fn write_message_to_fd(message: IpcMessage, fd: std::os::fd::RawFd) -> io::Result<()> {
    use std::os::fd::FromRawFd;
    // dup 返回的新描述符由此 File 独占，Drop 只关闭副本，不会关闭 Node 继承的 IPC 通道。
    let duplicate = unsafe { libc::dup(fd) };
    if duplicate < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut file = unsafe { std::fs::File::from_raw_fd(duplicate) };
    let serialized = serde_json::to_string(&message)?;
    writeln!(file, "{}", serialized)?;
    file.flush()
}

#[cfg(unix)]
fn write_message_for_ipc(message: IpcMessage) -> io::Result<()> {
    write_message_to_fd(message, 3)
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
}

#[cfg(all(test, unix))]
mod inherited_socket_tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::os::fd::AsRawFd;
    use std::os::unix::net::UnixStream;

    #[test]
    fn writes_json_lines_to_an_inherited_socket_without_closing_the_original() {
        let (writer, reader) = UnixStream::pair().unwrap();
        for message in ["first", "second"] {
            write_message_to_fd(
                IpcMessage {
                    code: IpcMessageCode::Ok,
                    message: message.into(),
                },
                writer.as_raw_fd(),
            )
            .unwrap();
        }
        let mut reader = BufReader::new(reader);
        for expected in ["first", "second"] {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let json: serde_json::Value = serde_json::from_str(&line).unwrap();
            assert_eq!(json["code"], 200);
            assert_eq!(json["message"], expected);
        }
    }

    #[test]
    fn invalid_inherited_descriptor_returns_an_io_error() {
        assert!(write_message_to_fd(
            IpcMessage {
                code: IpcMessageCode::Ok,
                message: "ready".into()
            },
            -1
        )
        .is_err());
    }
}

use std::{
    env,
    path::{Path, PathBuf},
};

use crate::helper::constants::UDS_SOCKET_NAME;

/// 获取系统临时目录路径
///
/// # Returns
///
/// 返回系统临时目录的字符串路径
///
/// # Examples
///
/// ```
/// let tmp_path = get_tmp_path();
/// log_print!("临时目录: {}", tmp_path);
/// ```
pub fn get_tmp_path() -> String {
    env::temp_dir().to_string_lossy().to_string()
}

/// 获取 IPC 通信路径
///
/// - Unix: 返回 UDS 套接字路径（临时目录下的 .sock 文件）
/// - Windows: 返回 Named Pipe 路径（`\\.\pipe\mito_node_{pid}` 格式）
///
/// # Returns
///
/// 返回 IPC 通信的路径
pub fn get_socket_path() -> PathBuf {
    // Windows 使用 Named Pipe，不走文件系统的 UDS
    #[cfg(target_os = "windows")]
    {
        let pid = std::process::id();
        PathBuf::from(format!(r"\\.\pipe\mito_node_{}", pid))
    }

    #[cfg(not(target_os = "windows"))]
    {
        // todo 也可以指定从环境变量中获取
        let tmp_path = get_tmp_path();
        Path::new(&tmp_path).join(UDS_SOCKET_NAME)
    }
}

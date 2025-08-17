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
/// println!("临时目录: {}", tmp_path);
/// ```
pub fn get_tmp_path() -> String {
    env::temp_dir().to_string_lossy().to_string()
}

/// 获取 UDS 套接字路径
///
/// # Returns
///
/// 返回 UDS 套接字的路径
pub fn get_socket_path() -> PathBuf {
    // todo 也可以指定从环境变量中获取
    let tmp_path = get_tmp_path();
    Path::new(&tmp_path).join(UDS_SOCKET_NAME)
}

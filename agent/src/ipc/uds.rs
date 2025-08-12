use crate::helper::constants::UDS_SOCKET_NAME;
use crate::helper::path::get_tmp_path;
use std::os::unix::net::UnixListener;
use std::path::Path;

pub fn create_uds_socket() -> Result<UnixListener, std::io::Error> {
    // 调用 utils::path 模块的 get_tmp_path 函数获取临时路径
    let tmp_path = get_tmp_path();
    let socket_path = Path::new(&tmp_path).join(UDS_SOCKET_NAME);
    return UnixListener::bind(socket_path);
}

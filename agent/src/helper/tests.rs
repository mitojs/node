use std::io;

use super::config::{AppConfig, TcpConfig};
use super::constants::{IpcMessageCode, ListenerResultType, AGENT_TCP_PORT};
use super::error::{utils::to_user_friendly, AppError};
use super::path::{get_socket_path, get_tmp_path};

// ─── error.rs ────────────────────────────────────────────

#[test]
fn test_display_io_error() {
    let err = AppError::Io(io::Error::new(io::ErrorKind::NotFound, "file missing"));
    let msg = format!("{}", err);
    assert!(msg.contains("IO 错误"));
    assert!(msg.contains("file missing"));
}

#[test]
fn test_display_config_error() {
    let err = AppError::Config("bad port".into());
    let msg = format!("{}", err);
    assert!(msg.contains("配置错误"));
    assert!(msg.contains("bad port"));
}

#[test]
fn test_display_all_variants() {
    let cases: Vec<(AppError, &str)> = vec![
        (
            AppError::Io(io::Error::new(io::ErrorKind::Other, "x")),
            "IO 错误",
        ),
        (AppError::Config("x".into()), "配置错误"),
        (AppError::Network("x".into()), "网络错误"),
        (AppError::DataProcessing("x".into()), "数据处理错误"),
        (AppError::Serialization("x".into()), "序列化错误"),
        (AppError::Unknown("x".into()), "未知错误"),
    ];
    for (err, prefix) in cases {
        assert!(
            format!("{}", err).contains(prefix),
            "expected prefix '{}' in '{}'",
            prefix,
            err
        );
    }
}

#[test]
fn test_from_io_error() {
    let io_err = io::Error::new(io::ErrorKind::PermissionDenied, "denied");
    let app_err: AppError = io_err.into();
    assert!(matches!(app_err, AppError::Io(_)));
}

#[test]
fn test_from_serde_json_error() {
    let json_err = serde_json::from_str::<serde_json::Value>("{{bad}}").unwrap_err();
    let app_err: AppError = json_err.into();
    assert!(matches!(app_err, AppError::Serialization(_)));
}

#[test]
fn test_from_string() {
    let app_err: AppError = String::from("something wrong").into();
    assert!(matches!(app_err, AppError::Unknown(_)));
    assert!(format!("{}", app_err).contains("something wrong"));
}

#[test]
fn test_from_str() {
    let app_err: AppError = "str error".into();
    assert!(matches!(app_err, AppError::Unknown(_)));
    assert!(format!("{}", app_err).contains("str error"));
}

#[test]
fn test_to_user_friendly() {
    let cases: Vec<(AppError, &str)> = vec![
        (
            AppError::Io(io::Error::new(io::ErrorKind::Other, "x")),
            "系统 IO 操作失败",
        ),
        (AppError::Config("x".into()), "配置参数错误"),
        (AppError::Network("x".into()), "网络连接失败"),
        (AppError::DataProcessing("x".into()), "数据处理失败"),
        (AppError::Serialization("x".into()), "数据格式错误"),
        (AppError::Unknown("x".into()), "未知错误"),
    ];
    for (err, expected) in cases {
        assert_eq!(to_user_friendly(&err), expected);
    }
}

// ─── config.rs ───────────────────────────────────────────

#[test]
fn test_default_tcp_config() {
    let cfg = TcpConfig::default();
    assert_eq!(cfg.port, AGENT_TCP_PORT);
    assert_eq!(cfg.host, "localhost");
}

#[test]
fn test_default_app_config() {
    let cfg = AppConfig::default();
    assert_eq!(cfg.tcp.port, AGENT_TCP_PORT);
    assert_eq!(cfg.tcp.host, "localhost");
    assert_eq!(cfg.agent_dir, "");
}

#[test]
fn test_validate_ok() {
    let cfg = AppConfig::default();
    assert!(cfg.validate().is_ok());
}

#[test]
fn test_validate_port_zero() {
    let mut cfg = AppConfig::default();
    cfg.tcp.port = 0;
    assert!(cfg.validate().is_err());
}

// ─── constants.rs ────────────────────────────────────────

#[test]
fn test_ipc_message_code_serialize() {
    let ok_json = serde_json::to_value(IpcMessageCode::Ok).unwrap();
    assert_eq!(ok_json, serde_json::json!(200));

    let err_json = serde_json::to_value(IpcMessageCode::Err).unwrap();
    assert_eq!(err_json, serde_json::json!(500));
}

#[test]
fn test_listener_result_type_display() {
    assert_eq!(ListenerResultType::Success.to_string(), "success");
    assert_eq!(ListenerResultType::AddrInUse.to_string(), "addr_in_use");

    let reason = ListenerResultType::FailedReason("timeout".into());
    // strum Display 只输出变体名，不含内部数据
    assert_eq!(reason.to_string(), "FailedReason");
}

#[test]
fn test_listener_result_type_from_str() {
    use std::str::FromStr;
    let parsed = ListenerResultType::from_str("success").unwrap();
    assert!(matches!(parsed, ListenerResultType::Success));

    let parsed = ListenerResultType::from_str("addr_in_use").unwrap();
    assert!(matches!(parsed, ListenerResultType::AddrInUse));
}

// ─── path.rs ─────────────────────────────────────────────

#[test]
fn test_get_tmp_path_not_empty() {
    let p = get_tmp_path();
    assert!(!p.is_empty());
}

#[test]
fn test_get_socket_path_ends_with_sock() {
    let p = get_socket_path();
    let s = p.to_string_lossy();
    assert!(
        s.ends_with("_mito_node_.sock"),
        "socket path should end with _mito_node_.sock, got: {}",
        s
    );
}

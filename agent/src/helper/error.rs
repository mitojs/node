use std::fmt;
use std::io;

// 导入宏
use crate::{log_print, debug_print, error_print};

/// 应用程序错误类型
#[derive(Debug)]
pub enum AppError {
    /// IO 错误
    Io(io::Error),
    /// 配置错误
    Config(String),
    /// 网络错误
    Network(String),
    /// 数据处理错误
    DataProcessing(String),
    /// 序列化错误
    Serialization(String),
    /// 未知错误
    Unknown(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Io(err) => write!(f, "IO 错误: {}", err),
            AppError::Config(msg) => write!(f, "配置错误: {}", msg),
            AppError::Network(msg) => write!(f, "网络错误: {}", msg),
            AppError::DataProcessing(msg) => write!(f, "数据处理错误: {}", msg),
            AppError::Serialization(msg) => write!(f, "序列化错误: {}", msg),
            AppError::Unknown(msg) => write!(f, "未知错误: {}", msg),
        }
    }
}

impl std::error::Error for AppError {}

impl From<io::Error> for AppError {
    fn from(err: io::Error) -> Self {
        AppError::Io(err)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Serialization(err.to_string())
    }
}

impl From<String> for AppError {
    fn from(msg: String) -> Self {
        AppError::Unknown(msg)
    }
}

impl From<&str> for AppError {
    fn from(msg: &str) -> Self {
        AppError::Unknown(msg.to_string())
    }
}

/// 结果类型别名
pub type AppResult<T> = Result<T, AppError>;

/// 错误处理工具函数
pub mod utils {
    use super::*;

    /// 将错误转换为用户友好的消息
    pub fn to_user_friendly(error: &AppError) -> String {
        match error {
            AppError::Io(_) => "系统 IO 操作失败".to_string(),
            AppError::Config(_) => "配置参数错误".to_string(),
            AppError::Network(_) => "网络连接失败".to_string(),
            AppError::DataProcessing(_) => "数据处理失败".to_string(),
            AppError::Serialization(_) => "数据格式错误".to_string(),
            AppError::Unknown(_) => "未知错误".to_string(),
        }
    }

    /// 记录错误日志
    pub fn log_error(error: &AppError) {
        error_print!("错误: {}", error);
    }
}

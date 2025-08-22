/// 带有 [Agent] 前缀的日志宏
#[macro_export]
macro_rules! log_print {
    ($($arg:tt)*) => {
        println!("[Agent] {}", format!($($arg)*));
    };
}

/// 带有 [Agent] 前缀的调试日志宏
#[macro_export]
macro_rules! debug_print {
    ($($arg:tt)*) => {
        println!("[Agent] DEBUG: {}", format!($($arg)*));
    };
}

/// 带有 [Agent] 前缀的错误日志宏
#[macro_export]
macro_rules! error_print {
    ($($arg:tt)*) => {
        eprintln!("[Agent] ERROR: {}", format!($($arg)*));
    };
}

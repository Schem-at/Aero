use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl fmt::Display for LogLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LogLevel::Debug => write!(f, "debug"),
            LogLevel::Info => write!(f, "info"),
            LogLevel::Warn => write!(f, "warn"),
            LogLevel::Error => write!(f, "error"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogCategory {
    System,
    Protocol,
    Handshake,
    Status,
    Ping,
    Transport,
    Wasm,
    Login,
    Encryption,
    Chat,
}

impl fmt::Display for LogCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LogCategory::System => write!(f, "system"),
            LogCategory::Protocol => write!(f, "protocol"),
            LogCategory::Handshake => write!(f, "handshake"),
            LogCategory::Status => write!(f, "status"),
            LogCategory::Ping => write!(f, "ping"),
            LogCategory::Transport => write!(f, "transport"),
            LogCategory::Wasm => write!(f, "wasm"),
            LogCategory::Login => write!(f, "login"),
            LogCategory::Encryption => write!(f, "encryption"),
            LogCategory::Chat => write!(f, "chat"),
        }
    }
}

pub trait Logger: Send + Sync {
    fn log(&self, level: LogLevel, category: LogCategory, message: &str);
}

/// Logger for WASM — calls window.__mc_server_log via wasm-bindgen
#[cfg(target_arch = "wasm32")]
pub struct WasmLogger;

#[cfg(target_arch = "wasm32")]
mod wasm_log_bridge {
    use wasm_bindgen::prelude::*;
    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = window, js_name = __mc_server_log)]
        pub fn server_log(level: &str, category: &str, message: &str);
    }
}

#[cfg(target_arch = "wasm32")]
impl Logger for WasmLogger {
    fn log(&self, level: LogLevel, category: LogCategory, message: &str) {
        wasm_log_bridge::server_log(&level.to_string(), &category.to_string(), message);
    }
}

/// Logger for standalone mode — prints to stderr with formatting
#[cfg(feature = "standalone")]
pub struct StdoutLogger;

#[cfg(feature = "standalone")]
impl Logger for StdoutLogger {
    fn log(&self, level: LogLevel, category: LogCategory, message: &str) {
        let level_color = match level {
            LogLevel::Debug => "\x1b[90m",
            LogLevel::Info => "\x1b[32m",
            LogLevel::Warn => "\x1b[33m",
            LogLevel::Error => "\x1b[31m",
        };
        let reset = "\x1b[0m";
        eprintln!(
            "{level_color}[{level}]{reset} \x1b[36m[{category}]{reset} {message}"
        );
    }
}

/// Logger for tests — captures messages into a Vec
pub struct TestLogger {
    pub messages: std::sync::Mutex<Vec<String>>,
}

impl TestLogger {
    pub fn new() -> Self {
        TestLogger {
            messages: std::sync::Mutex::new(Vec::new()),
        }
    }
}

impl Logger for TestLogger {
    fn log(&self, level: LogLevel, category: LogCategory, message: &str) {
        self.messages
            .lock()
            .unwrap()
            .push(format!("[{level}] [{category}] {message}"));
    }
}

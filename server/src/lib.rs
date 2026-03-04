pub mod protocol;
pub mod logging;
pub mod stats;
pub mod connection;
pub mod crypto;
pub mod compression;
pub mod nbt;
pub mod registry;
pub mod world;

#[cfg(target_arch = "wasm32")]
mod wasm_exports {
    use crate::connection::Connection;
    use crate::logging::WasmLogger;
    use std::cell::RefCell;
    use wasm_bindgen::prelude::*;

    thread_local! {
        static CONNECTION: RefCell<Connection> = RefCell::new(
            Connection::new(Box::new(WasmLogger))
        );
    }

    #[wasm_bindgen]
    pub fn reset_state() {
        CONNECTION.with(|c| c.borrow_mut().reset());
    }

    #[wasm_bindgen]
    pub fn handle_packet(data: &[u8]) -> Vec<u8> {
        CONNECTION.with(|c| c.borrow_mut().handle_packet(data))
    }

    #[wasm_bindgen]
    pub fn get_stats() -> String {
        CONNECTION.with(|c| {
            serde_json::to_string(&c.borrow().stats).unwrap_or_else(|_| "{}".to_string())
        })
    }

    #[wasm_bindgen]
    pub fn get_packet_log() -> String {
        CONNECTION.with(|c| {
            let entries = c.borrow_mut().packet_log.drain_all();
            serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_string())
        })
    }

    /// Check if there's a pending Mojang auth request.
    /// Returns JSON `{"username":"...","server_hash":"..."}` or empty string if none.
    #[wasm_bindgen]
    pub fn get_pending_auth() -> String {
        CONNECTION.with(|c| {
            let conn = c.borrow();
            match &conn.pending_auth {
                Some(pending) => {
                    serde_json::json!({
                        "username": pending.username,
                        "server_hash": pending.server_hash,
                    }).to_string()
                }
                None => String::new(),
            }
        })
    }

    /// Complete Mojang authentication with the session server response.
    /// Returns encrypted bytes containing Set Compression + Login Success.
    #[wasm_bindgen]
    pub fn complete_auth(response: &str) -> Vec<u8> {
        CONNECTION.with(|c| c.borrow_mut().complete_auth(response))
    }

    /// Queue a chat message to be sent to the Minecraft client.
    #[wasm_bindgen]
    pub fn queue_chat(message: &str) {
        CONNECTION.with(|c| {
            let mut conn = c.borrow_mut();
            conn.log(
                crate::logging::LogLevel::Info,
                crate::logging::LogCategory::Chat,
                &format!("[Server] {}", message),
            );
            conn.chat_queue.push(message.to_string());
        });
    }

    /// Update server configuration (MOTD, max players, etc.) from JSON.
    #[wasm_bindgen]
    pub fn set_server_config(json: &str) {
        if let Ok(config) = serde_json::from_str::<crate::stats::ServerConfig>(json) {
            CONNECTION.with(|c| {
                c.borrow_mut().server_config = config;
            });
        }
    }
}

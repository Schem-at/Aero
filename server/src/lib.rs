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

    /// Build Play init packets (Login Play, Game Event, Spawn, View Position, Chunk Batch Start).
    /// Returns encrypted bytes ready for the wire.
    #[wasm_bindgen]
    pub fn play_init() -> Vec<u8> {
        CONNECTION.with(|c| {
            let mut conn = c.borrow_mut();
            let threshold = conn.compression_threshold.unwrap_or(256);
            let data = crate::world::build_play_init(1, threshold);
            conn.awaiting_chunks = true;
            if let Some(ref mut cipher) = conn.cipher {
                let mut encrypted = data;
                cipher.encrypt(&mut encrypted);
                encrypted
            } else {
                data
            }
        })
    }

    /// Build a single chunk packet from a flat block state array.
    /// `block_states` is a u16 slice of 98304 entries.
    /// Returns encrypted bytes ready for the wire.
    #[wasm_bindgen]
    pub fn build_chunk(cx: i32, cz: i32, block_states: &[u16]) -> Vec<u8> {
        CONNECTION.with(|c| {
            let mut conn = c.borrow_mut();
            let threshold = conn.compression_threshold.unwrap_or(256);
            let data = crate::world::build_chunk_from_blocks(cx, cz, block_states, threshold);
            if let Some(ref mut cipher) = conn.cipher {
                let mut encrypted = data;
                cipher.encrypt(&mut encrypted);
                encrypted
            } else {
                data
            }
        })
    }

    /// Build finish packets (Chunk Batch Finished + Sync Player Position for initial spawn).
    /// Returns encrypted bytes ready for the wire.
    #[wasm_bindgen]
    pub fn play_finish(chunk_count: i32) -> Vec<u8> {
        CONNECTION.with(|c| {
            let mut conn = c.borrow_mut();
            let threshold = conn.compression_threshold.unwrap_or(256);
            let data = crate::world::build_play_finish(chunk_count, threshold);
            conn.awaiting_chunks = false;
            if let Some(ref mut cipher) = conn.cipher {
                let mut encrypted = data;
                cipher.encrypt(&mut encrypted);
                encrypted
            } else {
                data
            }
        })
    }

    /// Build just Chunk Batch Finished (for ongoing chunk loading — no teleport).
    /// Returns encrypted bytes ready for the wire.
    #[wasm_bindgen]
    pub fn chunk_batch_end(chunk_count: i32) -> Vec<u8> {
        CONNECTION.with(|c| {
            let mut conn = c.borrow_mut();
            let threshold = conn.compression_threshold.unwrap_or(256);
            let data = crate::world::build_chunk_batch_end(chunk_count, threshold);
            conn.awaiting_chunks = false;
            if let Some(ref mut cipher) = conn.cipher {
                let mut encrypted = data;
                cipher.encrypt(&mut encrypted);
                encrypted
            } else {
                data
            }
        })
    }

    /// Check if the server is waiting for chunk data from the generator.
    #[wasm_bindgen]
    pub fn get_awaiting_chunks() -> bool {
        CONNECTION.with(|c| c.borrow().awaiting_chunks)
    }

    /// Clear the awaiting_chunks flag.
    #[wasm_bindgen]
    pub fn clear_awaiting_chunks() {
        CONNECTION.with(|c| c.borrow_mut().awaiting_chunks = false);
    }

    /// Get the chunk center the player has moved to.
    /// Returns "cx,cz" if there's a pending center, or empty string if none.
    #[wasm_bindgen]
    pub fn get_pending_chunk_center() -> String {
        CONNECTION.with(|c| {
            let conn = c.borrow();
            match conn.pending_chunk_center {
                Some((cx, cz)) => format!("{},{}", cx, cz),
                None => String::new(),
            }
        })
    }

    /// Clear the pending chunk center after chunks have been requested.
    #[wasm_bindgen]
    pub fn clear_pending_chunk_center() {
        CONNECTION.with(|c| c.borrow_mut().pending_chunk_center = None);
    }
}

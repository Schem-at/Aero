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
    use crate::stats::ServerConfig;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use wasm_bindgen::prelude::*;

    struct ConnectionPool {
        connections: HashMap<u32, Connection>,
        next_id: u32,
        server_config: ServerConfig,
    }

    impl ConnectionPool {
        fn new() -> Self {
            ConnectionPool {
                connections: HashMap::new(),
                next_id: 1,
                server_config: ServerConfig::default(),
            }
        }
    }

    thread_local! {
        static POOL: RefCell<ConnectionPool> = RefCell::new(ConnectionPool::new());
    }

    /// Create a new connection and return its ID.
    #[wasm_bindgen]
    pub fn create_connection() -> u32 {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            let id = pool.next_id;
            pool.next_id += 1;
            let mut conn = Connection::new(Box::new(WasmLogger));
            conn.entity_id = id as i32;
            conn.server_config = pool.server_config.clone();
            pool.connections.insert(id, conn);
            id
        })
    }

    /// Remove a connection by ID.
    #[wasm_bindgen]
    pub fn remove_connection(id: u32) {
        POOL.with(|p| {
            p.borrow_mut().connections.remove(&id);
        })
    }

    /// Get the number of active connections.
    #[wasm_bindgen]
    pub fn get_connection_count() -> u32 {
        POOL.with(|p| p.borrow().connections.len() as u32)
    }

    /// Get all active connection IDs as a JSON array.
    #[wasm_bindgen]
    pub fn get_connection_ids() -> String {
        POOL.with(|p| {
            let ids: Vec<u32> = p.borrow().connections.keys().copied().collect();
            serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string())
        })
    }

    // --- Legacy single-connection compat (deprecated, uses connection_id=0 for old callers) ---

    #[wasm_bindgen]
    pub fn reset_state() {
        // No-op in pool mode — use create_connection/remove_connection instead
    }

    // --- Per-connection exports ---

    #[wasm_bindgen]
    pub fn handle_packet(id: u32, data: &[u8]) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.handle_packet(data)
            } else {
                Vec::new()
            }
        })
    }

    #[wasm_bindgen]
    pub fn get_stats(id: u32) -> String {
        POOL.with(|p| {
            let pool = p.borrow();
            if let Some(conn) = pool.connections.get(&id) {
                serde_json::to_string(&conn.stats).unwrap_or_else(|_| "{}".to_string())
            } else {
                "{}".to_string()
            }
        })
    }

    /// Get aggregate stats across all connections.
    #[wasm_bindgen]
    pub fn get_aggregate_stats() -> String {
        POOL.with(|p| {
            let pool = p.borrow();
            let mut total = crate::stats::ConnectionStats::default();
            total.player_count = pool.connections.values()
                .filter(|c| c.state == crate::connection::ConnectionState::Play)
                .count() as u32;
            for conn in pool.connections.values() {
                total.packets_in += conn.stats.packets_in;
                total.bytes_in += conn.stats.bytes_in;
                total.bytes_out += conn.stats.bytes_out;
                total.tick_count += conn.stats.tick_count;
                if conn.stats.tps > 0.0 { total.tps = conn.stats.tps; }
                if conn.stats.mspt > 0.0 { total.mspt = conn.stats.mspt; }
            }
            serde_json::to_string(&total).unwrap_or_else(|_| "{}".to_string())
        })
    }

    #[wasm_bindgen]
    pub fn get_packet_log(id: u32) -> String {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                let entries = conn.packet_log.drain_all();
                serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_string())
            } else {
                "[]".to_string()
            }
        })
    }

    /// Get all packet logs across all connections.
    #[wasm_bindgen]
    pub fn get_all_packet_logs() -> String {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            let mut all_entries = Vec::new();
            for conn in pool.connections.values_mut() {
                all_entries.extend(conn.packet_log.drain_all());
            }
            serde_json::to_string(&all_entries).unwrap_or_else(|_| "[]".to_string())
        })
    }

    #[wasm_bindgen]
    pub fn get_pending_auth(id: u32) -> String {
        POOL.with(|p| {
            let pool = p.borrow();
            if let Some(conn) = pool.connections.get(&id) {
                match &conn.pending_auth {
                    Some(pending) => {
                        serde_json::json!({
                            "username": pending.username,
                            "server_hash": pending.server_hash,
                        }).to_string()
                    }
                    None => String::new(),
                }
            } else {
                String::new()
            }
        })
    }

    #[wasm_bindgen]
    pub fn complete_auth(id: u32, response: &str) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.complete_auth(response)
            } else {
                Vec::new()
            }
        })
    }

    #[wasm_bindgen]
    pub fn queue_chat(id: u32, message: &str) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.log(
                    crate::logging::LogLevel::Info,
                    crate::logging::LogCategory::Chat,
                    &format!("[Server] {}", message),
                );
                conn.chat_queue.push(message.to_string());
            }
        });
    }

    /// Queue a chat message for ALL connected players in Play state.
    #[wasm_bindgen]
    pub fn broadcast_chat(message: &str) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            for conn in pool.connections.values_mut() {
                if conn.state == crate::connection::ConnectionState::Play {
                    conn.chat_queue.push(message.to_string());
                }
            }
        });
    }

    #[wasm_bindgen]
    pub fn build_disconnect(id: u32, reason_json: &str) -> Vec<u8> {
        use crate::protocol::types::write_string;
        use crate::protocol::packet::frame_packet;

        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                let payload = write_string(reason_json);
                let data = frame_packet(0x00, &payload);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Update server configuration globally.
    #[wasm_bindgen]
    pub fn set_server_config(json: &str) {
        if let Ok(config) = serde_json::from_str::<ServerConfig>(json) {
            POOL.with(|p| {
                let mut pool = p.borrow_mut();
                pool.server_config = config.clone();
                for conn in pool.connections.values_mut() {
                    conn.server_config = config.clone();
                }
            });
        }
    }

    #[wasm_bindgen]
    pub fn play_init(id: u32) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let entity_id = conn.entity_id;
                let (uuid, username, properties) = if let Some(ref ld) = conn.login_data {
                    (
                        ld.player_uuid.as_deref().unwrap_or("00000000000000000000000000000000"),
                        ld.username.as_str(),
                        ld.properties.as_slice(),
                    )
                } else {
                    ("00000000000000000000000000000000", "Player", &[][..])
                };
                let fly_speed = conn.fly_speed;
                let view_dist = conn.server_config.render_distance as i32;
                let data = crate::world::build_play_init(entity_id, threshold, uuid, username, properties, fly_speed, view_dist);
                conn.awaiting_chunks = true;
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    #[wasm_bindgen]
    pub fn build_chunk(id: u32, cx: i32, cz: i32, block_states: &[u16]) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let data = crate::world::build_chunk_from_blocks(cx, cz, block_states, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    #[wasm_bindgen]
    pub fn play_finish(id: u32, chunk_count: i32) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let data = crate::world::build_play_finish_at(
                    chunk_count, threshold,
                    conn.player_x, conn.player_y, conn.player_z,
                    conn.player_yaw, conn.player_pitch,
                );
                conn.awaiting_chunks = false;
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    #[wasm_bindgen]
    pub fn chunk_batch_start(id: u32) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let data = crate::compression::compress_packet(0x0C, &[], threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    #[wasm_bindgen]
    pub fn chunk_batch_end(id: u32, chunk_count: i32) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
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
            } else {
                Vec::new()
            }
        })
    }

    #[wasm_bindgen]
    pub fn get_awaiting_chunks(id: u32) -> bool {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.awaiting_chunks).unwrap_or(false)
        })
    }

    #[wasm_bindgen]
    pub fn clear_awaiting_chunks(id: u32) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.awaiting_chunks = false;
            }
        })
    }

    #[wasm_bindgen]
    pub fn get_pending_chunk_center(id: u32) -> String {
        POOL.with(|p| {
            let pool = p.borrow();
            if let Some(conn) = pool.connections.get(&id) {
                match conn.pending_chunk_center {
                    Some((cx, cz)) => format!("{},{}", cx, cz),
                    None => String::new(),
                }
            } else {
                String::new()
            }
        })
    }

    #[wasm_bindgen]
    pub fn clear_pending_chunk_center(id: u32) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.pending_chunk_center = None;
            }
        })
    }

    // --- Multiplayer packet builders ---
    // These build packets encrypted for a specific connection (target player).

    /// Build a Spawn Entity packet for the target connection.
    /// Used to make a player visible to another player.
    #[wasm_bindgen]
    pub fn build_spawn_entity(target_id: u32, entity_id: i32, uuid: &str, x: f64, y: f64, z: f64, yaw: f32, pitch: f32) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_spawn_entity_payload(entity_id, uuid, x, y, z, yaw, pitch);
                let data = crate::compression::compress_packet(0x01, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Build an Entity Teleport packet for the target connection.
    #[wasm_bindgen]
    pub fn build_entity_teleport(target_id: u32, entity_id: i32, x: f64, y: f64, z: f64, yaw: f32, pitch: f32, on_ground: bool) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_entity_teleport_payload(entity_id, x, y, z, yaw, pitch, on_ground);
                let data = crate::compression::compress_packet(0x7b, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Build a Set Head Rotation packet for the target connection.
    #[wasm_bindgen]
    pub fn build_head_rotation(target_id: u32, entity_id: i32, yaw: f32) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_head_rotation_payload(entity_id, yaw);
                let data = crate::compression::compress_packet(0x51, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Build a Remove Entities packet for the target connection.
    /// entity_ids_json is a JSON array of entity IDs, e.g. "[1,2,3]".
    #[wasm_bindgen]
    pub fn build_remove_entities(target_id: u32, entity_ids_json: &str) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let ids: Vec<i32> = serde_json::from_str(entity_ids_json).unwrap_or_default();
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_remove_entities_payload(&ids);
                let data = crate::compression::compress_packet(0x4b, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Build a Player Info Update (add player) packet for the target connection.
    #[wasm_bindgen]
    pub fn build_player_info_add(target_id: u32, uuid: &str, username: &str, properties_json: &str) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let properties: Vec<(String, String, Option<String>)> =
                    serde_json::from_str(properties_json).unwrap_or_default();
                let payload = crate::world::build_player_info_update(uuid, username, &properties);
                let data = crate::compression::compress_packet(0x44, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Build a Player Info Remove packet (0x43) for the target connection.
    #[wasm_bindgen]
    pub fn build_player_info_remove(target_id: u32, uuid: &str) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_player_info_remove_payload(uuid);
                let data = crate::compression::compress_packet(0x43, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Build a System Chat packet for the target connection.
    #[wasm_bindgen]
    pub fn build_system_chat(target_id: u32, message: &str) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_system_chat_payload(message);
                let data = crate::compression::compress_packet(0x77, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Get login data for a connection (username, uuid, properties).
    /// Returns JSON or empty string if not logged in.
    #[wasm_bindgen]
    pub fn get_login_data(id: u32) -> String {
        POOL.with(|p| {
            let pool = p.borrow();
            if let Some(conn) = pool.connections.get(&id) {
                if let Some(ref ld) = conn.login_data {
                    serde_json::json!({
                        "username": ld.username,
                        "uuid": ld.player_uuid.as_deref().unwrap_or(""),
                        "properties": ld.properties.iter().map(|(n, v, s)| {
                            serde_json::json!([n, v, s])
                        }).collect::<Vec<_>>(),
                    }).to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        })
    }

    /// Get the entity ID for a connection.
    #[wasm_bindgen]
    pub fn get_entity_id(id: u32) -> i32 {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.entity_id).unwrap_or(0)
        })
    }

    /// Get pending tp target (player name) if set by /tp <player>.
    #[wasm_bindgen]
    pub fn get_pending_tp(id: u32) -> String {
        POOL.with(|p| {
            let pool = p.borrow();
            if let Some(conn) = pool.connections.get(&id) {
                conn.pending_tp_target.clone().unwrap_or_default()
            } else {
                String::new()
            }
        })
    }

    /// Clear pending tp target.
    #[wasm_bindgen]
    pub fn clear_pending_tp(id: u32) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.pending_tp_target = None;
            }
        })
    }

    /// Get pending chat broadcast message (set by in-game chat).
    #[wasm_bindgen]
    pub fn get_pending_chat_broadcast(id: u32) -> String {
        POOL.with(|p| {
            let pool = p.borrow();
            if let Some(conn) = pool.connections.get(&id) {
                conn.pending_chat_broadcast.clone().unwrap_or_default()
            } else {
                String::new()
            }
        })
    }

    /// Clear pending chat broadcast.
    #[wasm_bindgen]
    pub fn clear_pending_chat_broadcast(id: u32) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.pending_chat_broadcast = None;
            }
        })
    }

    /// Get pending block events as JSON. Returns "[]" if none.
    #[wasm_bindgen]
    pub fn get_pending_block_events(id: u32) -> String {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                if conn.pending_block_events.is_empty() {
                    return String::new();
                }
                let events: Vec<_> = conn.pending_block_events.drain(..).map(|e| {
                    serde_json::json!({
                        "x": e.x,
                        "y": e.y,
                        "z": e.z,
                        "block_state": e.block_state,
                    })
                }).collect();
                serde_json::to_string(&events).unwrap_or_else(|_| "[]".to_string())
            } else {
                String::new()
            }
        })
    }

    /// Build a Block Update (0x08) packet for a target connection.
    #[wasm_bindgen]
    pub fn build_block_update(target_id: u32, x: i32, y: i32, z: i32, block_state: i32) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::protocol::packets::block_events::build_block_update_payload(x, y, z, block_state);
                let data = crate::compression::compress_packet(0x08, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Set the item-to-block-state mapping for a connection.
    /// JSON format: {"item_id": block_state_id, ...}
    #[wasm_bindgen]
    pub fn set_item_block_map(id: u32, json: &str) {
        if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, i32>>(json) {
            POOL.with(|p| {
                let mut pool = p.borrow_mut();
                if let Some(conn) = pool.connections.get_mut(&id) {
                    conn.item_to_block.clear();
                    for (k, v) in map {
                        if let Ok(item_id) = k.parse::<i32>() {
                            conn.item_to_block.insert(item_id, v);
                        }
                    }
                }
            });
        }
    }

    /// Build Set Entity Data (0x61) — skin customization metadata for a player entity.
    /// Returns encrypted bytes to send to target_id.
    #[wasm_bindgen]
    pub fn build_entity_metadata(target_id: u32, entity_id: i32, skin_parts: u8) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_entity_metadata_payload(entity_id, skin_parts);
                let data = crate::compression::compress_packet(0x61, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Get the skin_parts byte for a connection.
    #[wasm_bindgen]
    pub fn get_skin_parts(id: u32) -> u8 {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.skin_parts).unwrap_or(0x7F)
        })
    }

    /// Check if skin_parts changed since last check.
    #[wasm_bindgen]
    pub fn get_skin_parts_dirty(id: u32) -> bool {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.skin_parts_dirty).unwrap_or(false)
        })
    }

    /// Clear the skin_parts dirty flag.
    #[wasm_bindgen]
    pub fn clear_skin_parts_dirty(id: u32) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.skin_parts_dirty = false;
            }
        });
    }

    /// Build Set Entity Data for entity flags + pose (sneaking/sprinting visual).
    #[wasm_bindgen]
    pub fn build_entity_flags(target_id: u32, entity_id: i32, flags: u8, pose: u8) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_entity_flags_payload(entity_id, flags, pose);
                let data = crate::compression::compress_packet(0x61, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    #[wasm_bindgen]
    pub fn get_entity_flags_dirty(id: u32) -> bool {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.entity_flags_dirty).unwrap_or(false)
        })
    }

    #[wasm_bindgen]
    pub fn clear_entity_flags_dirty(id: u32) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.entity_flags_dirty = false;
            }
        });
    }

    #[wasm_bindgen]
    pub fn get_entity_flags(id: u32) -> u8 {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.entity_flags).unwrap_or(0)
        })
    }

    #[wasm_bindgen]
    pub fn get_entity_pose(id: u32) -> u8 {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.entity_pose).unwrap_or(0)
        })
    }

    /// Build Entity Animation (0x02) — swing arm etc.
    #[wasm_bindgen]
    pub fn build_entity_animation(target_id: u32, entity_id: i32, animation: u8) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_entity_animation_payload(entity_id, animation);
                let data = crate::compression::compress_packet(0x02, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    #[wasm_bindgen]
    pub fn get_pending_swing(id: u32) -> bool {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.pending_swing).unwrap_or(false)
        })
    }

    #[wasm_bindgen]
    pub fn clear_pending_swing(id: u32) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.pending_swing = false;
            }
        });
    }

    #[wasm_bindgen]
    pub fn get_pending_respawn(id: u32) -> bool {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.pending_respawn).unwrap_or(false)
        })
    }

    #[wasm_bindgen]
    pub fn clear_pending_respawn(id: u32) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.pending_respawn = false;
            }
        });
    }

    /// Get pending attacks (entity IDs) as JSON array. Returns empty string if none.
    #[wasm_bindgen]
    pub fn get_pending_attacks(id: u32) -> String {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                if conn.pending_attacks.is_empty() {
                    return String::new();
                }
                let attacks = std::mem::take(&mut conn.pending_attacks);
                serde_json::to_string(&attacks).unwrap_or_default()
            } else {
                String::new()
            }
        })
    }

    /// Build Hurt Animation (0x29) + Damage Event (0x19) + Entity Velocity (0x63) for PvP hit.
    #[wasm_bindgen]
    pub fn build_damage_packets(target_id: u32, victim_entity_id: i32, attacker_entity_id: i32, yaw: f32, vx: f64, vy: f64, vz: f64) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let mut data = Vec::new();
                // Hurt Animation (0x29)
                data.extend_from_slice(&crate::compression::compress_packet(
                    0x29,
                    &crate::world::build_hurt_animation_payload(victim_entity_id, yaw),
                    threshold,
                ));
                // Damage Event (0x19) — source_type 34 = player_attack
                data.extend_from_slice(&crate::compression::compress_packet(
                    0x19,
                    &crate::world::build_damage_event_payload(victim_entity_id, 34, attacker_entity_id),
                    threshold,
                ));
                // Entity Velocity (0x63)
                data.extend_from_slice(&crate::compression::compress_packet(
                    0x63,
                    &crate::world::build_entity_velocity_payload(victim_entity_id, vx, vy, vz),
                    threshold,
                ));
                if let Some(ref mut cipher) = conn.cipher {
                    cipher.encrypt(&mut data);
                }
                data
            } else {
                Vec::new()
            }
        })
    }

    /// Build Set Health (0x66) to send to a player.
    #[wasm_bindgen]
    pub fn build_set_health(target_id: u32, health: f32) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_set_health_payload(health, 20, 5.0);
                let data = crate::compression::compress_packet(0x66, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Build Combat Death (0x42) packet — sent to the dying player.
    #[wasm_bindgen]
    pub fn build_combat_death(target_id: u32, player_entity_id: i32, killer_name: &str) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_combat_death_payload(player_entity_id, killer_name);
                let data = crate::compression::compress_packet(0x42, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Build respawn packets: Respawn (0x4D) + health reset + position sync.
    #[wasm_bindgen]
    pub fn build_respawn(target_id: u32, gamemode: u8) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let mut rp = Vec::new();
                rp.extend_from_slice(&crate::protocol::types::write_varint(0)); // dim type
                rp.extend_from_slice(&crate::protocol::types::write_string("minecraft:overworld"));
                rp.extend_from_slice(&0i64.to_be_bytes()); // hashed seed
                rp.push(gamemode); // game mode
                rp.push(0xFF); // previous game mode
                rp.push(0); // is debug
                rp.push(1); // is flat
                rp.push(0); // has death location
                rp.extend_from_slice(&crate::protocol::types::write_varint(0)); // portal cooldown
                rp.extend_from_slice(&crate::protocol::types::write_varint(63)); // sea level
                rp.push(0); // data kept = 0

                conn.health = 20.0;
                conn.entity_flags = 0; // clear elytra, sprint, etc.
                conn.entity_pose = 0; // standing
                conn.entity_flags_dirty = true;
                conn.on_ground = true;
                conn.pending_fall_damage = 0.0;
                conn.awaiting_chunks = true;

                let mut data = Vec::new();
                data.extend_from_slice(&crate::compression::compress_packet(0x4D, &rp, threshold));
                // Set health to 20
                data.extend_from_slice(&crate::compression::compress_packet(
                    0x66,
                    &crate::world::build_set_health_payload(20.0, 20, 5.0),
                    threshold,
                ));
                // Game event: start waiting for chunks (event=13)
                data.extend_from_slice(&crate::compression::compress_packet(
                    0x26,
                    &crate::world::build_game_event(13, 0.0),
                    threshold,
                ));

                if let Some(ref mut cipher) = conn.cipher {
                    cipher.encrypt(&mut data);
                }
                data
            } else {
                Vec::new()
            }
        })
    }

    /// Get/set health for a connection.
    #[wasm_bindgen]
    pub fn get_health(id: u32) -> f32 {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.health).unwrap_or(0.0)
        })
    }

    #[wasm_bindgen]
    pub fn set_health(id: u32, health: f32) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.health = health;
            }
        });
    }

    #[wasm_bindgen]
    pub fn get_gamemode(id: u32) -> u8 {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.gamemode).unwrap_or(1)
        })
    }

    #[wasm_bindgen]
    pub fn set_gamemode(id: u32, gamemode: u8) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.gamemode = gamemode;
            }
        });
    }

    /// Teleport a player to coordinates (called from JS after resolving /tp <player>).
    /// Returns the encrypted response bytes (Set Center Chunk + Sync Position + chat).
    #[wasm_bindgen]
    pub fn teleport_player(id: u32, x: f64, y: f64, z: f64, message: &str) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                let threshold = conn.compression_threshold.unwrap_or(256);

                conn.player_x = x;
                conn.player_y = y;
                conn.player_z = z;
                conn.position_dirty = true;

                let chunk_x = (x.floor() as i32) >> 4;
                let chunk_z = (z.floor() as i32) >> 4;
                conn.player_chunk_x = chunk_x;
                conn.player_chunk_z = chunk_z;
                conn.pending_chunk_center = Some((chunk_x, chunk_z));
                conn.awaiting_chunks = true;

                let mut data = Vec::new();
                // Set Center Chunk
                let mut view_pos = Vec::new();
                view_pos.extend_from_slice(&crate::protocol::types::write_varint(chunk_x));
                view_pos.extend_from_slice(&crate::protocol::types::write_varint(chunk_z));
                data.extend_from_slice(&crate::compression::compress_packet(0x5C, &view_pos, threshold));
                // Sync Position
                data.extend_from_slice(&crate::compression::compress_packet(
                    0x46,
                    &crate::world::build_sync_player_position_at(x, y, z, conn.player_yaw, conn.player_pitch),
                    threshold,
                ));
                // Chat confirmation
                data.extend_from_slice(&crate::compression::compress_packet(
                    0x77,
                    &crate::world::build_system_chat_payload(message),
                    threshold,
                ));

                if let Some(ref mut cipher) = conn.cipher {
                    cipher.encrypt(&mut data);
                }
                data
            } else {
                Vec::new()
            }
        })
    }

    /// Get the player's position if it changed since last call.
    /// Returns empty string if no change, or JSON {x,y,z,yaw,pitch} if dirty.
    #[wasm_bindgen]
    pub fn get_player_position(id: u32) -> String {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                if conn.position_dirty {
                    conn.position_dirty = false;
                    format!("{{\"x\":{},\"y\":{},\"z\":{},\"yaw\":{},\"pitch\":{}}}",
                        conn.player_x, conn.player_y, conn.player_z,
                        conn.player_yaw, conn.player_pitch)
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        })
    }

    // --- Fall damage ---

    #[wasm_bindgen]
    pub fn get_pending_fall_damage(id: u32) -> f32 {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.pending_fall_damage).unwrap_or(0.0)
        })
    }

    #[wasm_bindgen]
    pub fn clear_pending_fall_damage(id: u32) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.pending_fall_damage = 0.0;
            }
        });
    }

    // --- Held item / equipment ---

    #[wasm_bindgen]
    pub fn get_held_item_dirty(id: u32) -> bool {
        POOL.with(|p| {
            let pool = p.borrow();
            pool.connections.get(&id).map(|c| c.held_item_dirty).unwrap_or(false)
        })
    }

    #[wasm_bindgen]
    pub fn clear_held_item_dirty(id: u32) {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&id) {
                conn.held_item_dirty = false;
            }
        });
    }

    #[wasm_bindgen]
    pub fn get_held_item_id(id: u32) -> i32 {
        POOL.with(|p| {
            let pool = p.borrow();
            if let Some(conn) = pool.connections.get(&id) {
                let slot = conn.held_slot as usize;
                conn.hotbar_items[slot.min(8)]
            } else {
                0
            }
        })
    }

    /// Build Entity Equipment (0x64) — main hand item visible to other players.
    #[wasm_bindgen]
    pub fn build_entity_equipment(target_id: u32, entity_id: i32, item_id: i32) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_entity_equipment_payload(entity_id, item_id);
                let data = crate::compression::compress_packet(0x64, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Build Entity Position Sync (0x23) — lightweight position update.
    #[wasm_bindgen]
    pub fn build_entity_position_sync(target_id: u32, entity_id: i32, x: f64, y: f64, z: f64, yaw: f32, pitch: f32, on_ground: bool) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_entity_position_sync_payload(entity_id, x, y, z, yaw, pitch, on_ground);
                let data = crate::compression::compress_packet(0x23, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }

    /// Build Block Destroy Stage (0x05) — mining animation for other players.
    #[wasm_bindgen]
    pub fn build_block_destroy_stage(target_id: u32, entity_id: i32, x: i32, y: i32, z: i32, stage: i8) -> Vec<u8> {
        POOL.with(|p| {
            let mut pool = p.borrow_mut();
            if let Some(conn) = pool.connections.get_mut(&target_id) {
                let threshold = conn.compression_threshold.unwrap_or(256);
                let payload = crate::world::build_block_destroy_stage_payload(entity_id, x, y, z, stage);
                let data = crate::compression::compress_packet(0x05, &payload, threshold);
                if let Some(ref mut cipher) = conn.cipher {
                    let mut encrypted = data;
                    cipher.encrypt(&mut encrypted);
                    encrypted
                } else {
                    data
                }
            } else {
                Vec::new()
            }
        })
    }
}

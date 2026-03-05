use crate::compression::{compress_packet, decompress_packet};
use crate::crypto::{CipherPair, ServerKeyPair};
use crate::logging::{LogCategory, LogLevel, Logger};
use crate::protocol::handler::PacketRegistry;
use crate::protocol::packet::frame_packet;
use crate::protocol::types::{write_string, write_varint};
use crate::stats::{ConnectionStats, PacketLog, ServerConfig, TickTracker};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ConnectionState {
    Handshaking,
    Status,
    Login,
    Configuration,
    Play,
}

impl std::fmt::Display for ConnectionState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectionState::Handshaking => write!(f, "Handshaking"),
            ConnectionState::Status => write!(f, "Status"),
            ConnectionState::Login => write!(f, "Login"),
            ConnectionState::Configuration => write!(f, "Configuration"),
            ConnectionState::Play => write!(f, "Play"),
        }
    }
}

pub struct LoginData {
    pub username: String,
    pub player_uuid: Option<String>,
    pub properties: Vec<(String, String, Option<String>)>,
    pub key_pair: Option<ServerKeyPair>,
    pub verify_token: Option<Vec<u8>>,
    pub shared_secret: Option<[u8; 16]>,
    pub server_hash: Option<String>,
}

pub struct PendingAuthRequest {
    pub username: String,
    pub server_hash: String,
}

pub struct Connection {
    pub state: ConnectionState,
    pub protocol_version: i32,
    pub entity_id: i32,
    pub stats: ConnectionStats,
    pub packet_log: PacketLog,
    pub login_data: Option<LoginData>,
    pub pending_auth: Option<PendingAuthRequest>,
    pub cipher: Option<CipherPair>,
    pub compression_threshold: Option<i32>,
    last_keep_alive_ms: f64,
    tick_tracker: TickTracker,
    pub server_config: ServerConfig,
    pub chat_queue: Vec<String>,
    pub awaiting_chunks: bool,
    pub player_chunk_x: i32,
    pub player_chunk_z: i32,
    pub pending_chunk_center: Option<(i32, i32)>,
    pub fly_speed: f32,
    pub is_flying: bool,
    pub player_x: f64,
    pub player_y: f64,
    pub player_z: f64,
    pub player_yaw: f32,
    pub player_pitch: f32,
    pub position_dirty: bool,
    pub pending_tp_target: Option<String>,
    pub pending_chat_broadcast: Option<String>,
    logger: Box<dyn Logger>,
    registry: PacketRegistry,
}

impl Connection {
    pub fn new(logger: Box<dyn Logger>) -> Self {
        Connection {
            state: ConnectionState::Handshaking,
            protocol_version: 0,
            entity_id: 1,
            stats: ConnectionStats::default(),
            packet_log: PacketLog::new(),
            login_data: None,
            pending_auth: None,
            cipher: None,
            compression_threshold: None,
            last_keep_alive_ms: 0.0,
            tick_tracker: TickTracker::new(),
            server_config: ServerConfig::default(),
            chat_queue: Vec::new(),
            awaiting_chunks: false,
            player_chunk_x: 0,
            player_chunk_z: 0,
            pending_chunk_center: None,
            fly_speed: 0.05,
            is_flying: false,
            player_x: 8.0,
            player_y: 65.0,
            player_z: 8.0,
            player_yaw: 0.0,
            player_pitch: 0.0,
            position_dirty: false,
            pending_tp_target: None,
            pending_chat_broadcast: None,
            logger,
            registry: PacketRegistry::default_registry(),
        }
    }

    pub fn reset(&mut self) {
        self.state = ConnectionState::Handshaking;
        self.protocol_version = 0;
        self.login_data = None;
        self.pending_auth = None;
        self.cipher = None;
        self.compression_threshold = None;
        self.last_keep_alive_ms = 0.0;
        self.tick_tracker.reset();
        self.chat_queue.clear();
        self.awaiting_chunks = false;
        self.player_chunk_x = 0;
        self.player_chunk_z = 0;
        self.pending_chunk_center = None;
        self.fly_speed = 0.05;
        self.is_flying = false;
        self.player_x = 8.0;
        self.player_y = 65.0;
        self.player_z = 8.0;
        self.player_yaw = 0.0;
        self.player_pitch = 0.0;
        self.position_dirty = false;
        self.pending_tp_target = None;
        self.pending_chat_broadcast = None;
        self.stats.player_count = 0;
        self.stats.connected_at_ms = 0.0;
        self.log(LogLevel::Debug, LogCategory::System, "Connection state reset to Handshaking");
    }

    pub fn log(&self, level: LogLevel, category: LogCategory, message: &str) {
        self.logger.log(level, category, message);
    }

    pub fn logger(&self) -> &dyn Logger {
        &*self.logger
    }

    /// Build a System Chat Message packet (S→C 0x77).
    /// Text component is encoded as NBT (protocol 764+): bare TAG_String for plain text.
    fn build_system_chat(&self, message: &str) -> Vec<u8> {
        let bytes = message.as_bytes();
        let mut payload = Vec::with_capacity(1 + 2 + bytes.len() + 1);
        payload.push(0x08); // TAG_String type byte (raw NBT tag, no name)
        payload.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
        payload.extend_from_slice(bytes);
        payload.push(0); // overlay = false (shows in chat, not action bar)
        if let Some(threshold) = self.compression_threshold {
            compress_packet(0x77, &payload, threshold)
        } else {
            frame_packet(0x77, &payload)
        }
    }

    pub fn handle_packet(&mut self, data: &[u8]) -> Vec<u8> {
        use crate::protocol::packet::read_packet;
        use crate::protocol::handler::HandlerContext;
        use crate::stats::{Timer, now_ms, hex_dump, PacketLogEntry};

        // Decrypt incoming data if cipher is active
        let decrypted;
        let working_data = if let Some(ref mut cipher) = self.cipher {
            decrypted = {
                let mut buf = data.to_vec();
                cipher.decrypt(&mut buf);
                buf
            };
            &decrypted[..]
        } else {
            data
        };

        let mut offset = 0;
        let mut response = Vec::new();

        while offset < working_data.len() {
            let remaining = &working_data[offset..];
            if remaining.is_empty() {
                break;
            }

            // Read packet — use decompression if compression is active
            let (packet_id, payload, consumed) = if self.compression_threshold.is_some() {
                let (id, payload, consumed) = decompress_packet(remaining);
                (id, payload, consumed)
            } else {
                let (id, payload_slice, consumed) = read_packet(remaining);
                (id, payload_slice.to_vec(), consumed)
            };

            let raw_bytes = &working_data[offset..offset + consumed];
            offset += consumed;

            let timer = Timer::start();

            let pre_handler_state = self.state;
            let handler = self.registry.get(self.state, packet_id);
            let handler_name = handler.name().to_string();
            let is_silent = handler.silent();

            let mut ctx = HandlerContext {
                state: &mut self.state,
                protocol_version: &mut self.protocol_version,
                packet_id,
                stats: &mut self.stats,
                logger: &*self.logger,
                login_data: &mut self.login_data,
                pending_auth: &mut self.pending_auth,
                cipher: &mut self.cipher,
                compression_threshold: &self.compression_threshold,
                server_config: &self.server_config,
                awaiting_chunks: &mut self.awaiting_chunks,
                player_chunk_x: &mut self.player_chunk_x,
                player_chunk_z: &mut self.player_chunk_z,
                pending_chunk_center: &mut self.pending_chunk_center,
                fly_speed: &mut self.fly_speed,
                is_flying: &mut self.is_flying,
                player_x: &mut self.player_x,
                player_y: &mut self.player_y,
                player_z: &mut self.player_z,
                player_yaw: &mut self.player_yaw,
                player_pitch: &mut self.player_pitch,
                position_dirty: &mut self.position_dirty,
                pending_tp_target: &mut self.pending_tp_target,
                pending_chat_broadcast: &mut self.pending_chat_broadcast,
            };

            let result = handler.handle(&payload, &mut ctx);

            let elapsed_ns = timer.elapsed_ns();

            // Record stats (always, even for silent packets)
            self.stats.record_in(&handler_name, consumed as u64, elapsed_ns);

            // Accumulate processing time for MSPT calculation
            self.tick_tracker.accumulate_processing(elapsed_ns);

            // Track TPS/MSPT from Tick End packets
            if handler_name == "Tick End" {
                let (tps, mspt) = self.tick_tracker.record_tick();
                self.stats.tick_count += 1;
                self.stats.tps = tps;
                self.stats.mspt = mspt;
            }

            // Track player count and connection time on Play state entry
            if self.state == ConnectionState::Play && self.stats.player_count == 0 {
                self.stats.player_count = 1;
            }
            if self.stats.connected_at_ms == 0.0 && self.stats.packets_in == 1 {
                self.stats.connected_at_ms = crate::stats::now_ms();
            }

            // Log the incoming packet (skip silent packets like tick_end)
            if !is_silent {
                self.packet_log.push(PacketLogEntry {
                    direction: "in",
                    state: pre_handler_state.to_string(),
                    packet_id,
                    packet_name: handler_name.clone(),
                    size: consumed,
                    hex_dump: hex_dump(raw_bytes, 512),
                    raw_payload: hex_dump(&payload, 4096),
                    timestamp_ms: now_ms(),
                    processing_ns: elapsed_ns,
                });
            }

            match result {
                crate::protocol::handler::PacketResult::Response(resp_data) |
                crate::protocol::handler::PacketResult::RawResponse(resp_data) => {
                    // Response and RawResponse both contain pre-framed packet bytes
                    let out_size = resp_data.len();
                    self.packet_log.push(PacketLogEntry {
                        direction: "out",
                        state: pre_handler_state.to_string(),
                        packet_id,
                        packet_name: format!("{} Response", handler_name),
                        size: out_size,
                        hex_dump: hex_dump(&resp_data, 512),
                        raw_payload: hex_dump(&resp_data, 4096),
                        timestamp_ms: now_ms(),
                        processing_ns: 0,
                    });
                    self.stats.record_out(out_size as u64);
                    response.extend_from_slice(&resp_data);
                }
                crate::protocol::handler::PacketResult::None => {}
            }
        }

        // Send Keep Alive if in Play state and enough time has passed
        if self.state == ConnectionState::Play {
            let now = crate::stats::now_ms();
            if now - self.last_keep_alive_ms > 10_000.0 {
                self.last_keep_alive_ms = now;
                let keep_alive_id = now as i64;
                if let Some(threshold) = self.compression_threshold {
                    let ka_packet = compress_packet(0x2B, &keep_alive_id.to_be_bytes(), threshold);
                    response.extend_from_slice(&ka_packet);
                }
            }

            // Drain chat queue — send queued messages as System Chat packets
            let messages: Vec<String> = self.chat_queue.drain(..).collect();
            for msg in messages {
                let chat_packet = self.build_system_chat(&msg);
                response.extend_from_slice(&chat_packet);
            }
        }

        // Encrypt outgoing data if cipher is active
        if let Some(ref mut cipher) = self.cipher {
            cipher.encrypt(&mut response);
        }

        response
    }

    /// Complete Mojang authentication after JS fetches the session server response.
    ///
    /// Returns encrypted bytes containing Set Compression + Login Success packets.
    pub fn complete_auth(&mut self, mojang_response: &str) -> Vec<u8> {
        use crate::stats::{now_ms, hex_dump, PacketLogEntry};

        self.log(LogLevel::Info, LogCategory::Login, "Processing Mojang auth response");

        // Parse Mojang response JSON
        let mojang: serde_json::Value = match serde_json::from_str(mojang_response) {
            Ok(v) => v,
            Err(e) => {
                self.log(LogLevel::Error, LogCategory::Login,
                    &format!("Failed to parse Mojang response: {}", e));
                return Vec::new();
            }
        };

        let uuid_str = mojang["id"].as_str().unwrap_or("");
        let name = mojang["name"].as_str().unwrap_or("");
        let properties = mojang.get("properties").cloned().unwrap_or(serde_json::Value::Array(vec![]));

        self.log(LogLevel::Info, LogCategory::Login,
            &format!("Authenticated player: {} (UUID: {})", name, uuid_str));

        // Clear pending auth
        self.pending_auth = None;

        // Store player info
        if let Some(ref mut login_data) = self.login_data {
            login_data.player_uuid = Some(uuid_str.to_string());
            login_data.username = name.to_string();
            if let Some(props) = properties.as_array() {
                login_data.properties = props.iter().map(|p| {
                    let pname = p["name"].as_str().unwrap_or("").to_string();
                    let pvalue = p["value"].as_str().unwrap_or("").to_string();
                    let psig = p["signature"].as_str().map(|s| s.to_string());
                    (pname, pvalue, psig)
                }).collect();
            }
        }

        let mut response = Vec::new();

        // 1. Set Compression (0x03) — old packet format (no compression yet), encrypted
        let threshold: i32 = 256;
        let compression_payload = write_varint(threshold);
        let set_compression = frame_packet(0x03, &compression_payload);

        self.packet_log.push(PacketLogEntry {
            direction: "out",
            state: self.state.to_string(),
            packet_id: 0x03,
            packet_name: "Set Compression".to_string(),
            size: set_compression.len(),
            hex_dump: hex_dump(&set_compression, 512),
            raw_payload: hex_dump(&set_compression, 4096),
            timestamp_ms: now_ms(),
            processing_ns: 0,
        });

        response.extend_from_slice(&set_compression);

        // Enable compression for subsequent packets
        self.compression_threshold = Some(threshold);
        self.log(LogLevel::Info, LogCategory::Login,
            &format!("Compression enabled with threshold {}", threshold));

        // 2. Login Success (0x02) — compressed format (new), encrypted
        let login_success_payload = build_login_success_payload(uuid_str, name, &properties, self.protocol_version);
        let login_success = compress_packet(0x02, &login_success_payload, threshold);

        self.packet_log.push(PacketLogEntry {
            direction: "out",
            state: self.state.to_string(),
            packet_id: 0x02,
            packet_name: "Login Success".to_string(),
            size: login_success.len(),
            hex_dump: hex_dump(&login_success, 512),
            raw_payload: hex_dump(&login_success, 4096),
            timestamp_ms: now_ms(),
            processing_ns: 0,
        });

        response.extend_from_slice(&login_success);

        self.log(LogLevel::Info, LogCategory::Login,
            &format!("Login Success sent for {} (UUID: {})", name, uuid_str));

        // Encrypt the entire response
        if let Some(ref mut cipher) = self.cipher {
            cipher.encrypt(&mut response);
        }

        response
    }
}

/// Build the Login Success (0x02) payload bytes.
///
/// Format: UUID (16 bytes) + Username (String) + Number Of Properties (VarInt)
///   + for each property: Name (String) + Value (String) + Is Signed (bool) + [Signature (String)]
///   + Strict Error Handling (bool) — only for protocol < 770
fn build_login_success_payload(uuid_str: &str, name: &str, properties: &serde_json::Value, protocol_version: i32) -> Vec<u8> {
    let mut payload = Vec::new();

    // UUID: parse hex string to 16 bytes
    let uuid_hex: String = uuid_str.chars().filter(|c| *c != '-').collect();
    if uuid_hex.len() == 32 {
        for i in 0..16 {
            let byte = u8::from_str_radix(&uuid_hex[i*2..i*2+2], 16).unwrap_or(0);
            payload.push(byte);
        }
    } else {
        // Fallback: 16 zero bytes
        payload.extend_from_slice(&[0u8; 16]);
    }

    // Username
    payload.extend_from_slice(&write_string(name));

    // Properties array
    let props_array = properties.as_array().map(|a| a.as_slice()).unwrap_or(&[]);
    payload.extend_from_slice(&write_varint(props_array.len() as i32));

    for prop in props_array {
        let prop_name = prop["name"].as_str().unwrap_or("");
        let prop_value = prop["value"].as_str().unwrap_or("");
        let prop_signature = prop["signature"].as_str();

        payload.extend_from_slice(&write_string(prop_name));
        payload.extend_from_slice(&write_string(prop_value));

        if let Some(sig) = prop_signature {
            payload.push(1); // is_signed = true
            payload.extend_from_slice(&write_string(sig));
        } else {
            payload.push(0); // is_signed = false
        }
    }

    // Strict Error Handling — removed in protocol 770 (1.21.2+)
    if protocol_version < 770 {
        payload.push(1); // true
    }

    payload
}

use crate::connection::{ConnectionState, LoginData, PendingAuthRequest};
use crate::crypto::CipherPair;
use crate::logging::{LogCategory, LogLevel, Logger};
use crate::stats::{ConnectionStats, ServerConfig};
use std::collections::HashMap;

pub enum PacketResult {
    /// Payload-only response — will be framed with the incoming packet ID and optionally compressed.
    Response(Vec<u8>),
    /// Pre-framed response bytes — sent as-is (no framing/compression applied by handle_packet).
    /// Used when the response packet ID differs from the incoming packet ID.
    RawResponse(Vec<u8>),
    None,
}

pub struct HandlerContext<'a> {
    pub state: &'a mut ConnectionState,
    pub protocol_version: &'a mut i32,
    pub packet_id: i32,
    pub stats: &'a mut ConnectionStats,
    pub logger: &'a dyn Logger,
    pub login_data: &'a mut Option<LoginData>,
    pub pending_auth: &'a mut Option<PendingAuthRequest>,
    pub cipher: &'a mut Option<CipherPair>,
    pub compression_threshold: &'a Option<i32>,
    pub server_config: &'a ServerConfig,
    pub awaiting_chunks: &'a mut bool,
    pub player_chunk_x: &'a mut i32,
    pub player_chunk_z: &'a mut i32,
    pub pending_chunk_center: &'a mut Option<(i32, i32)>,
    pub fly_speed: &'a mut f32,
    pub is_flying: &'a mut bool,
}

impl<'a> HandlerContext<'a> {
    pub fn log(&self, level: LogLevel, category: LogCategory, message: &str) {
        self.logger.log(level, category, message);
    }
}

pub trait PacketHandler: Send + Sync {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult;
    fn name(&self) -> &'static str;
    /// If true, this packet is not logged to the packet inspector (e.g. tick_end, keep_alive).
    fn silent(&self) -> bool { false }
}

type HandlerKey = (ConnectionState, i32);

pub struct PacketRegistry {
    handlers: HashMap<HandlerKey, Box<dyn PacketHandler>>,
    unknown: Box<dyn PacketHandler>,
}

impl PacketRegistry {
    pub fn new() -> Self {
        PacketRegistry {
            handlers: HashMap::new(),
            unknown: Box::new(super::packets::unknown::UnknownHandler),
        }
    }

    pub fn register(&mut self, state: ConnectionState, packet_id: i32, handler: Box<dyn PacketHandler>) {
        self.handlers.insert((state, packet_id), handler);
    }

    pub fn get(&self, state: ConnectionState, packet_id: i32) -> &dyn PacketHandler {
        self.handlers
            .get(&(state, packet_id))
            .map(|h| &**h)
            .unwrap_or(&*self.unknown)
    }

    pub fn default_registry() -> Self {
        use super::packets::*;

        let mut reg = Self::new();
        reg.register(
            ConnectionState::Handshaking,
            0x00,
            Box::new(handshake::HandshakeHandler),
        );
        reg.register(
            ConnectionState::Status,
            0x00,
            Box::new(status_request::StatusRequestHandler),
        );
        reg.register(
            ConnectionState::Status,
            0x01,
            Box::new(ping::PingHandler),
        );
        reg.register(
            ConnectionState::Login,
            0x00,
            Box::new(login_start::LoginStartHandler),
        );
        reg.register(
            ConnectionState::Login,
            0x01,
            Box::new(encryption_response::EncryptionResponseHandler),
        );
        reg.register(
            ConnectionState::Login,
            0x03,
            Box::new(login_acknowledged::LoginAcknowledgedHandler),
        );

        // Configuration state handlers
        reg.register(
            ConnectionState::Configuration,
            0x00,
            Box::new(client_information::ClientInformationHandler),
        );
        reg.register(
            ConnectionState::Configuration,
            0x02,
            Box::new(plugin_message::PluginMessageHandler),
        );
        reg.register(
            ConnectionState::Configuration,
            0x07,
            Box::new(known_packs::KnownPacksHandler),
        );
        reg.register(
            ConnectionState::Configuration,
            0x03,
            Box::new(acknowledge_finish_config::AcknowledgeFinishConfigHandler),
        );

        // Play state handlers (protocol 774 — IDs shifted +1 after 0x03 due to new change_gamemode packet)
        reg.register(
            ConnectionState::Play,
            0x00,
            Box::new(confirm_teleportation::ConfirmTeleportationHandler),
        );
        reg.register(
            ConnectionState::Play,
            0x0A, // was 0x09 in protocol 769
            Box::new(chunk_batch_received::ChunkBatchReceivedHandler),
        );
        reg.register(
            ConnectionState::Play,
            0x0C, // tick_end — 0-byte payload, sent every tick
            Box::new(tick_end::TickEndHandler),
        );
        reg.register(
            ConnectionState::Play,
            0x0D, // was 0x0C in protocol 769
            Box::new(client_settings_play::ClientSettingsPlayHandler),
        );
        reg.register(
            ConnectionState::Play,
            0x1B, // was 0x1A in protocol 769
            Box::new(keep_alive::KeepAliveHandler),
        );

        // Logged but ignored Play packets
        reg.register(ConnectionState::Play, 0x09,
            Box::new(play_ignore::LogHandler { name: "Chat Session Update" }));
        reg.register(ConnectionState::Play, 0x15,
            Box::new(play_ignore::LogHandler { name: "Plugin Message (Play)" }));
        reg.register(ConnectionState::Play, 0x28, // was incorrectly 0x27
            Box::new(play_ignore::LogHandler { name: "Player Action" }));
        reg.register(ConnectionState::Play, 0x2B,
            Box::new(play_ignore::LogHandler { name: "Player Loaded" }));
        reg.register(ConnectionState::Play, 0x34,
            Box::new(play_ignore::LogHandler { name: "Set Held Item" }));

        // Player Abilities (0x27) — flying toggle
        reg.register(ConnectionState::Play, 0x27,
            Box::new(player_abilities::PlayerAbilitiesHandler));

        // Player position packets — track chunk position for ongoing chunk loading
        reg.register(ConnectionState::Play, 0x1D,
            Box::new(player_position::PlayerPositionHandler));
        reg.register(ConnectionState::Play, 0x1E,
            Box::new(player_position::PlayerPositionHandler));
        reg.register(ConnectionState::Play, 0x1F,
            Box::new(play_ignore::SilentHandler { name: "Player Look" }));
        reg.register(ConnectionState::Play, 0x20,
            Box::new(play_ignore::SilentHandler { name: "Player On Ground" }));
        reg.register(ConnectionState::Play, 0x29, // Player Command (sprint/sneak/elytra)
            Box::new(play_ignore::SilentHandler { name: "Player Command" }));
        reg.register(ConnectionState::Play, 0x2A, // was incorrectly 0x29
            Box::new(play_ignore::SilentHandler { name: "Player Input" }));
        reg.register(ConnectionState::Play, 0x3C, // was incorrectly 0x2A
            Box::new(play_ignore::SilentHandler { name: "Swing Arm" }));

        // Chat packets
        reg.register(
            ConnectionState::Play,
            0x08,
            Box::new(chat_message::ChatMessageHandler),
        );
        reg.register(
            ConnectionState::Play,
            0x06,
            Box::new(chat_command::ChatCommandHandler),
        );

        reg
    }
}

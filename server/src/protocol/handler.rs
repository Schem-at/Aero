use crate::connection::{ConnectionState, LoginData, PendingAuthRequest};
use crate::crypto::CipherPair;
use crate::logging::{LogCategory, LogLevel, Logger};
use crate::protocol::packets::block_events::BlockEvent;
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
    pub player_x: &'a mut f64,
    pub player_y: &'a mut f64,
    pub player_z: &'a mut f64,
    pub player_yaw: &'a mut f32,
    pub player_pitch: &'a mut f32,
    pub position_dirty: &'a mut bool,
    pub pending_tp_target: &'a mut Option<String>,
    pub pending_chat_broadcast: &'a mut Option<String>,
    pub skin_parts: &'a mut u8,
    pub skin_parts_dirty: &'a mut bool,
    pub held_slot: &'a mut u8,
    pub hotbar_items: &'a mut [i32; 9],
    pub pending_block_events: &'a mut Vec<BlockEvent>,
    pub item_to_block: &'a HashMap<i32, i32>,
    pub entity_flags: &'a mut u8,
    pub entity_pose: &'a mut u8,
    pub entity_flags_dirty: &'a mut bool,
    pub pending_attacks: &'a mut Vec<i32>,
    pub health: &'a mut f32,
    pub gamemode: &'a mut u8,
    pub pending_swing: &'a mut bool,
    pub pending_respawn: &'a mut bool,
    pub on_ground: &'a mut bool,
    pub fall_start_y: &'a mut f64,
    pub pending_fall_damage: &'a mut f32,
    pub held_item_dirty: &'a mut bool,
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

        // Perform Respawn (0x0B in protocol 774)
        reg.register(ConnectionState::Play, 0x0B,
            Box::new(perform_respawn::PerformRespawnHandler));

        // Logged but ignored Play packets
        reg.register(ConnectionState::Play, 0x09,
            Box::new(play_ignore::LogHandler { name: "Chat Session Update" }));
        reg.register(ConnectionState::Play, 0x15,
            Box::new(play_ignore::LogHandler { name: "Plugin Message (Play)" }));
        reg.register(ConnectionState::Play, 0x28,
            Box::new(block_events::PlayerActionHandler));
        reg.register(ConnectionState::Play, 0x2B,
            Box::new(play_ignore::LogHandler { name: "Player Loaded" }));
        reg.register(ConnectionState::Play, 0x34,
            Box::new(block_events::SetHeldItemHandler));
        reg.register(ConnectionState::Play, 0x37,
            Box::new(block_events::SetCreativeSlotHandler));
        reg.register(ConnectionState::Play, 0x3F,
            Box::new(block_events::UseItemOnHandler));

        // Player Abilities (0x27) — flying toggle
        reg.register(ConnectionState::Play, 0x27,
            Box::new(player_abilities::PlayerAbilitiesHandler));

        // Player position packets — track chunk position for ongoing chunk loading
        reg.register(ConnectionState::Play, 0x1D,
            Box::new(player_position::PlayerPositionHandler));
        reg.register(ConnectionState::Play, 0x1E,
            Box::new(player_position::PlayerPositionHandler));
        reg.register(ConnectionState::Play, 0x1F,
            Box::new(player_position::PlayerPositionHandler));
        reg.register(ConnectionState::Play, 0x20,
            Box::new(player_position::PlayerPositionHandler));
        // Interact (0x19) — entity interaction (attack/right-click)
        reg.register(ConnectionState::Play, 0x19,
            Box::new(interact::InteractHandler));
        reg.register(ConnectionState::Play, 0x23, // Pick Item From Block
            Box::new(pick_item::PickItemFromBlockHandler));
        reg.register(ConnectionState::Play, 0x24, // Pick Item From Entity
            Box::new(pick_item::PickItemFromEntityHandler));
        reg.register(ConnectionState::Play, 0x25, // Ping Request (play)
            Box::new(play_ignore::SilentHandler { name: "Ping Request" }));
        reg.register(ConnectionState::Play, 0x29, // Player Command (sprint/elytra)
            Box::new(player_command::PlayerCommandHandler));
        reg.register(ConnectionState::Play, 0x2A, // Player Input (movement/sneak/sprint bitflags)
            Box::new(player_input::PlayerInputHandler));
        reg.register(ConnectionState::Play, 0x3C,
            Box::new(swing_arm::SwingArmHandler));

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

        // Silent handlers for common spam packets
        reg.register(ConnectionState::Play, 0x0E,
            Box::new(play_ignore::SilentHandler { name: "Command Suggestion" }));
        reg.register(ConnectionState::Play, 0x10,
            Box::new(play_ignore::SilentHandler { name: "Close Container" }));
        reg.register(ConnectionState::Play, 0x11,
            Box::new(play_ignore::SilentHandler { name: "Change Container Slot State" }));
        reg.register(ConnectionState::Play, 0x12,
            Box::new(play_ignore::SilentHandler { name: "Cookie Response" }));
        reg.register(ConnectionState::Play, 0x2C,
            Box::new(play_ignore::SilentHandler { name: "Pong" }));
        reg.register(ConnectionState::Play, 0x36,
            Box::new(play_ignore::SilentHandler { name: "Seen Advancements" }));
        reg.register(ConnectionState::Play, 0x3E,
            Box::new(play_ignore::SilentHandler { name: "Use Item" }));

        reg
    }
}

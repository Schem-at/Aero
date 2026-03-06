use crate::compression::compress_packet;
use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::{read_varint, write_string, write_varint};
use crate::registry::build_all_registry_packets;

pub struct KnownPacksHandler;

impl PacketHandler for KnownPacksHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        let (pack_count, _) = read_varint(payload);
        ctx.log(
            LogLevel::Info,
            LogCategory::Protocol,
            &format!("Known Packs received: {} packs", pack_count),
        );

        let threshold = ctx.compression_threshold.unwrap_or(256);
        let mut response = Vec::new();

        // 1. Send all Registry Data packets (0x07)
        ctx.log(LogLevel::Info, LogCategory::Protocol, "Sending registry data...");
        response.extend_from_slice(&build_all_registry_packets(threshold, ctx.server_config));

        // 2. Send server brand via Plugin Message (0x01)
        let mut brand_payload = Vec::new();
        brand_payload.extend_from_slice(&write_string("minecraft:brand"));
        brand_payload.extend_from_slice(&write_string("Aero"));
        response.extend_from_slice(&compress_packet(crate::protocol::packet_ids::clientbound::configuration::CUSTOM_PAYLOAD, &brand_payload, threshold));
        ctx.log(LogLevel::Info, LogCategory::Protocol, "Sent server brand: Aero");

        // 3. Send Feature Flags (0x0C)
        let mut feature_flags_payload = Vec::new();
        feature_flags_payload.extend_from_slice(&write_varint(1)); // 1 feature flag
        feature_flags_payload.extend_from_slice(&write_string("minecraft:vanilla"));
        response.extend_from_slice(&compress_packet(crate::protocol::packet_ids::clientbound::configuration::FEATURE_FLAGS, &feature_flags_payload, threshold));
        ctx.log(LogLevel::Info, LogCategory::Protocol, "Sent Feature Flags: minecraft:vanilla");

        // 4. Send Finish Configuration (0x03)
        response.extend_from_slice(&compress_packet(crate::protocol::packet_ids::clientbound::configuration::FINISH_CONFIGURATION, &[], threshold));
        ctx.log(LogLevel::Info, LogCategory::Protocol, "Sent Finish Configuration");

        PacketResult::RawResponse(response)
    }

    fn name(&self) -> &'static str {
        "Known Packs"
    }
}

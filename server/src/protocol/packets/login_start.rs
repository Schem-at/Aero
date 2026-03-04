use crate::connection::LoginData;
use crate::crypto::ServerKeyPair;
use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::packet::frame_packet;
use crate::protocol::types::{read_string, write_string, write_varint};

pub struct LoginStartHandler;

impl PacketHandler for LoginStartHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        // Parse Login Start: username (String) + UUID (16 bytes)
        let (username, offset) = read_string(payload);

        let mut player_uuid_hex = String::new();
        if offset + 16 <= payload.len() {
            for &b in &payload[offset..offset + 16] {
                player_uuid_hex.push_str(&format!("{:02x}", b));
            }
        }

        ctx.log(
            LogLevel::Info,
            LogCategory::Login,
            &format!("Login Start: username={}, uuid={}", username, player_uuid_hex),
        );

        // Generate RSA key pair
        let key_pair = ServerKeyPair::generate();
        ctx.log(LogLevel::Debug, LogCategory::Encryption, "RSA 1024-bit key pair generated");

        // Generate random 4-byte verify token
        let mut verify_token = [0u8; 4];
        use rand::RngCore;
        rand::thread_rng().fill_bytes(&mut verify_token);

        // Cache the public key DER for building the response
        let public_key_der = key_pair.public_key_der.clone();

        // Store login data
        *ctx.login_data = Some(LoginData {
            username,
            player_uuid: Some(player_uuid_hex),
            key_pair: Some(key_pair),
            verify_token: Some(verify_token.to_vec()),
            shared_secret: None,
            server_hash: None,
        });

        // Build Encryption Request (0x01)
        let mut resp_payload = Vec::new();

        // Server ID: empty string
        resp_payload.extend_from_slice(&write_string(""));

        // Public Key: VarInt length + bytes
        resp_payload.extend_from_slice(&write_varint(public_key_der.len() as i32));
        resp_payload.extend_from_slice(&public_key_der);

        // Verify Token: VarInt length + bytes
        resp_payload.extend_from_slice(&write_varint(verify_token.len() as i32));
        resp_payload.extend_from_slice(&verify_token);

        // Should Authenticate: true (boolean)
        resp_payload.push(1);

        ctx.log(
            LogLevel::Info,
            LogCategory::Login,
            &format!(
                "Encryption Request sent (pubkey {} bytes, verify token {} bytes)",
                public_key_der.len(),
                verify_token.len()
            ),
        );

        // Response packet ID (0x01) differs from incoming (0x00), so use RawResponse
        let framed = frame_packet(0x01, &resp_payload);
        PacketResult::RawResponse(framed)
    }

    fn name(&self) -> &'static str {
        "Login Start"
    }
}

use crate::connection::PendingAuthRequest;
use crate::crypto::{minecraft_hex_digest, CipherPair};
use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::read_varint;

pub struct EncryptionResponseHandler;

impl PacketHandler for EncryptionResponseHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        ctx.log(LogLevel::Info, LogCategory::Encryption, "Encryption Response received");

        // Parse: encrypted shared_secret (VarInt-prefixed) + encrypted verify_token (VarInt-prefixed)
        let (secret_len, offset1) = read_varint(payload);
        let encrypted_secret = &payload[offset1..offset1 + secret_len as usize];
        let pos = offset1 + secret_len as usize;

        let (token_len, offset2) = read_varint(&payload[pos..]);
        let encrypted_token = &payload[pos + offset2..pos + offset2 + token_len as usize];

        // Extract everything we need from login_data, then release the borrow
        let (shared_secret, server_hash, username) = {
            let login_data = match ctx.login_data.as_mut() {
                Some(data) => data,
                None => {
                    ctx.log(LogLevel::Error, LogCategory::Encryption, "No login data — unexpected Encryption Response");
                    return PacketResult::None;
                }
            };

            let key_pair = match login_data.key_pair.as_ref() {
                Some(kp) => kp,
                None => {
                    ctx.log(LogLevel::Error, LogCategory::Encryption, "No RSA key pair available");
                    return PacketResult::None;
                }
            };

            // RSA decrypt shared secret and verify token
            let shared_secret_bytes = key_pair.decrypt(encrypted_secret);
            let verify_token_bytes = key_pair.decrypt(encrypted_token);

            // Verify token matches original
            if let Some(ref original_token) = login_data.verify_token {
                if verify_token_bytes != *original_token {
                    // Can't call ctx.log here due to borrow, use logger directly
                    ctx.logger.log(LogLevel::Error, LogCategory::Encryption, "Verify token mismatch!");
                    return PacketResult::None;
                }
            }

            // Extract 16-byte shared secret
            let mut shared_secret = [0u8; 16];
            shared_secret.copy_from_slice(&shared_secret_bytes[..16]);

            // Compute server hash for Mojang authentication
            let server_hash = minecraft_hex_digest("", &shared_secret, &key_pair.public_key_der);

            let username = login_data.username.clone();

            // Store in login_data
            login_data.shared_secret = Some(shared_secret);
            login_data.server_hash = Some(server_hash.clone());

            (shared_secret, server_hash, username)
        };
        // login_data borrow is now released

        ctx.log(LogLevel::Debug, LogCategory::Encryption,
            &format!("Server hash computed: {}", server_hash));

        // Enable AES/CFB8 cipher — all subsequent traffic is encrypted
        *ctx.cipher = Some(CipherPair::new(&shared_secret));
        ctx.log(LogLevel::Info, LogCategory::Encryption, "AES-128/CFB8 encryption enabled");

        // Set pending auth — JS will handle async Mojang API call
        *ctx.pending_auth = Some(PendingAuthRequest {
            username,
            server_hash,
        });

        ctx.log(LogLevel::Info, LogCategory::Login,
            "Pending Mojang authentication — waiting for JS callback");

        PacketResult::None
    }

    fn name(&self) -> &'static str {
        "Encryption Response"
    }
}

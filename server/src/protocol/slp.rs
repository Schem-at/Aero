use super::types::{read_varint, read_string, write_string};
use serde::Serialize;

/// Parsed Handshake packet fields.
pub struct HandshakePacket {
    pub protocol_version: i32,
    pub server_address: String,
    pub server_port: u16,
    pub next_state: i32,
}

/// Parse a Handshake packet payload (after packet ID has been read).
pub fn parse_handshake(data: &[u8]) -> HandshakePacket {
    let (protocol_version, offset) = read_varint(data);
    let (server_address, offset2) = read_string(&data[offset..]);
    let pos = offset + offset2;
    let server_port = u16::from_be_bytes([data[pos], data[pos + 1]]);
    let (next_state, _) = read_varint(&data[pos + 2..]);
    HandshakePacket {
        protocol_version,
        server_address,
        server_port,
        next_state,
    }
}

#[derive(Serialize)]
struct StatusVersion {
    name: String,
    protocol: i32,
}

#[derive(Serialize)]
struct StatusPlayers {
    max: u32,
    online: u32,
    sample: Vec<()>,
}

#[derive(Serialize)]
struct StatusDescription {
    text: String,
}

#[derive(Serialize)]
struct StatusResponse {
    version: StatusVersion,
    players: StatusPlayers,
    description: StatusDescription,
    #[serde(skip_serializing_if = "Option::is_none")]
    favicon: Option<String>,
}

/// Build the Status Response JSON payload (as a Minecraft protocol string).
pub fn build_status_response(
    motd: &str,
    max_players: u32,
    online: u32,
    version_name: &str,
    protocol_version: i32,
    favicon: Option<&str>,
) -> Vec<u8> {
    let resp = StatusResponse {
        version: StatusVersion {
            name: version_name.to_string(),
            protocol: protocol_version,
        },
        players: StatusPlayers {
            max: max_players,
            online,
            sample: vec![],
        },
        description: StatusDescription {
            text: motd.to_string(),
        },
        favicon: favicon.map(|s| s.to_string()),
    };
    let json = serde_json::to_string(&resp).unwrap();
    write_string(&json)
}

/// Build a Pong response payload (i64 big-endian).
pub fn build_pong(payload: i64) -> Vec<u8> {
    payload.to_be_bytes().to_vec()
}

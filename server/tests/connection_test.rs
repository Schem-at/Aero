use minecraft_web_server::connection::Connection;
use minecraft_web_server::logging::TestLogger;
use minecraft_web_server::connection::ConnectionState;
use minecraft_web_server::protocol::types::{write_varint, write_string};
use minecraft_web_server::protocol::packet::frame_packet;
use std::sync::Arc;

fn build_handshake_packet() -> Vec<u8> {
    // Handshake: protocol=767, address="localhost", port=25565, next_state=1
    let mut payload = Vec::new();
    payload.extend_from_slice(&write_varint(767));
    payload.extend_from_slice(&write_string("localhost"));
    payload.extend_from_slice(&25565u16.to_be_bytes());
    payload.extend_from_slice(&write_varint(1)); // next_state = Status
    frame_packet(0x00, &payload)
}

fn build_status_request_packet() -> Vec<u8> {
    frame_packet(0x00, &[])
}

fn build_ping_packet(value: i64) -> Vec<u8> {
    frame_packet(0x01, &value.to_be_bytes())
}

fn make_test_connection() -> (Connection, Arc<TestLogger>) {
    let logger = Arc::new(TestLogger::new());
    let conn = Connection::new(Box::new(TestLoggerWrapper(logger.clone())));
    (conn, logger)
}

// Wrapper to use Arc<TestLogger> as Box<dyn Logger>
struct TestLoggerWrapper(Arc<TestLogger>);

impl minecraft_web_server::logging::Logger for TestLoggerWrapper {
    fn log(
        &self,
        level: minecraft_web_server::logging::LogLevel,
        category: minecraft_web_server::logging::LogCategory,
        message: &str,
    ) {
        self.0.log(level, category, message);
    }
}

#[test]
fn test_full_slp_flow() {
    let (mut conn, logger) = make_test_connection();

    // Start in Handshaking
    assert_eq!(conn.state, ConnectionState::Handshaking);

    // Send handshake
    let handshake = build_handshake_packet();
    let response = conn.handle_packet(&handshake);
    assert!(response.is_empty(), "Handshake should produce no response");
    assert_eq!(conn.state, ConnectionState::Status);

    // Send status request
    let status_req = build_status_request_packet();
    let response = conn.handle_packet(&status_req);
    assert!(!response.is_empty(), "Status request should produce response");

    // Send ping
    let ping = build_ping_packet(42);
    let response = conn.handle_packet(&ping);
    assert!(!response.is_empty(), "Ping should produce pong response");

    // After ping, state resets to Handshaking
    assert_eq!(conn.state, ConnectionState::Handshaking);

    // Verify logs contain expected messages
    let messages = logger.messages.lock().unwrap();
    assert!(
        messages.iter().any(|m: &String| m.contains("Handshake received")),
        "Should log handshake"
    );
    assert!(
        messages.iter().any(|m: &String| m.contains("Status Request received")),
        "Should log status request"
    );
    assert!(
        messages.iter().any(|m: &String| m.contains("Ping received")),
        "Should log ping"
    );
}

#[test]
fn test_stats_tracking() {
    let (mut conn, _) = make_test_connection();

    // Full SLP flow
    let handshake = build_handshake_packet();
    conn.handle_packet(&handshake);

    let status_req = build_status_request_packet();
    conn.handle_packet(&status_req);

    let ping = build_ping_packet(99);
    conn.handle_packet(&ping);

    // Check stats
    assert_eq!(conn.stats.packets_in, 3);
    assert!(conn.stats.bytes_in > 0);
    assert!(conn.stats.bytes_out > 0);
    assert!(conn.stats.per_packet_type.contains_key("Handshake"));
    assert!(conn.stats.per_packet_type.contains_key("StatusRequest"));
    assert!(conn.stats.per_packet_type.contains_key("Ping"));
}

#[test]
fn test_packet_log_entries() {
    let (mut conn, _) = make_test_connection();

    let handshake = build_handshake_packet();
    conn.handle_packet(&handshake);

    let entries = conn.packet_log.entries();
    assert!(!entries.is_empty(), "Should have packet log entries");
    assert_eq!(entries[0].direction, "in");
    assert_eq!(entries[0].packet_name, "Handshake");
}

#[test]
fn test_concatenated_packets() {
    let (mut conn, _) = make_test_connection();

    // Concatenate handshake + status request + ping
    let mut combined = build_handshake_packet();
    combined.extend_from_slice(&build_status_request_packet());
    combined.extend_from_slice(&build_ping_packet(7));

    let response = conn.handle_packet(&combined);
    assert!(!response.is_empty());
    assert_eq!(conn.stats.packets_in, 3);
    assert_eq!(conn.state, ConnectionState::Handshaking);
}

#[test]
fn test_unknown_packet_logged() {
    let (mut conn, logger) = make_test_connection();

    // Send unknown packet 0x42 in Handshaking state
    let unknown = frame_packet(0x42, &[0xDE, 0xAD]);
    conn.handle_packet(&unknown);

    let messages = logger.messages.lock().unwrap();
    assert!(
        messages.iter().any(|m: &String| m.contains("Unknown packet 0x42")),
        "Should log unknown packet"
    );
}

#[test]
fn test_packet_log_drain() {
    let (mut conn, _) = make_test_connection();

    let handshake = build_handshake_packet();
    conn.handle_packet(&handshake);

    assert!(!conn.packet_log.entries().is_empty());

    let drained = conn.packet_log.drain_all();
    assert!(!drained.is_empty());
    assert!(conn.packet_log.entries().is_empty(), "Should be empty after drain");
}

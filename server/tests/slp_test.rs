use minecraft_web_server::protocol::types::{read_varint, write_varint, read_string, write_string};

#[test]
fn test_varint_roundtrip() {
    let values = [0, 1, 127, 128, 255, 25565, 2147483647, -1];
    for &v in &values {
        let encoded = write_varint(v);
        let (decoded, _) = read_varint(&encoded);
        assert_eq!(v, decoded, "VarInt roundtrip failed for {v}");
    }
}

#[test]
fn test_string_roundtrip() {
    let (decoded, _) = read_string(&write_string("Hello"));
    assert_eq!(decoded, "Hello");
}

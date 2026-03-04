use super::types::{read_varint, write_varint};

/// Frame a packet: [VarInt length][VarInt packet_id][payload]
pub fn frame_packet(packet_id: i32, payload: &[u8]) -> Vec<u8> {
    let id_bytes = write_varint(packet_id);
    let length = id_bytes.len() + payload.len();
    let mut buf = write_varint(length as i32);
    buf.extend_from_slice(&id_bytes);
    buf.extend_from_slice(payload);
    buf
}

/// Read a packet from a byte slice.
/// Returns (packet_id, payload_slice, total_bytes_consumed).
pub fn read_packet(data: &[u8]) -> (i32, &[u8], usize) {
    let (length, len_size) = read_varint(data);
    let length = length as usize;
    let packet_start = len_size;
    let (packet_id, id_size) = read_varint(&data[packet_start..]);
    let payload = &data[packet_start + id_size..packet_start + length];
    (packet_id, payload, len_size + length)
}

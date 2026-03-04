use crate::protocol::types::{read_varint, write_varint};
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::io::{Read, Write};

/// Compress a packet with the Minecraft compressed format.
///
/// Format: `[VarInt packet_length][VarInt data_length][data]`
/// - If uncompressed size < threshold: data_length=0, data is raw (packet_id + payload)
/// - If uncompressed size >= threshold: data_length=uncompressed size, data is zlib-compressed
pub fn compress_packet(packet_id: i32, payload: &[u8], threshold: i32) -> Vec<u8> {
    let id_bytes = write_varint(packet_id);
    let uncompressed_size = id_bytes.len() + payload.len();

    if (uncompressed_size as i32) < threshold {
        // Below threshold: send uncompressed with data_length=0
        let data_length_bytes = write_varint(0);
        let packet_length = data_length_bytes.len() + id_bytes.len() + payload.len();
        let mut buf = write_varint(packet_length as i32);
        buf.extend_from_slice(&data_length_bytes);
        buf.extend_from_slice(&id_bytes);
        buf.extend_from_slice(payload);
        buf
    } else {
        // Above threshold: zlib compress (packet_id + payload)
        let mut uncompressed = Vec::with_capacity(uncompressed_size);
        uncompressed.extend_from_slice(&id_bytes);
        uncompressed.extend_from_slice(payload);

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&uncompressed).expect("zlib compress failed");
        let compressed = encoder.finish().expect("zlib finish failed");

        let data_length_bytes = write_varint(uncompressed_size as i32);
        let packet_length = data_length_bytes.len() + compressed.len();
        let mut buf = write_varint(packet_length as i32);
        buf.extend_from_slice(&data_length_bytes);
        buf.extend_from_slice(&compressed);
        buf
    }
}

/// Decompress a packet in the Minecraft compressed format.
///
/// Returns (packet_id, payload, total_bytes_consumed).
pub fn decompress_packet(data: &[u8]) -> (i32, Vec<u8>, usize) {
    let (packet_length, plen_size) = read_varint(data);
    let packet_length = packet_length as usize;
    let packet_data = &data[plen_size..plen_size + packet_length];

    let (data_length, dlen_size) = read_varint(packet_data);
    let remaining = &packet_data[dlen_size..];

    let decompressed = if data_length == 0 {
        // Uncompressed: remaining is raw packet_id + payload
        remaining.to_vec()
    } else {
        // Compressed: remaining is zlib data
        let mut decoder = ZlibDecoder::new(remaining);
        let mut buf = Vec::with_capacity(data_length as usize);
        decoder.read_to_end(&mut buf).expect("zlib decompress failed");
        buf
    };

    let (packet_id, id_size) = read_varint(&decompressed);
    let payload = decompressed[id_size..].to_vec();

    (packet_id, payload, plen_size + packet_length)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip_below_threshold() {
        let packet_id = 0x02;
        let payload = b"short".to_vec();
        let threshold = 256;

        let compressed = compress_packet(packet_id, &payload, threshold);
        let (dec_id, dec_payload, consumed) = decompress_packet(&compressed);

        assert_eq!(dec_id, packet_id);
        assert_eq!(dec_payload, payload);
        assert_eq!(consumed, compressed.len());
    }

    #[test]
    fn test_roundtrip_above_threshold() {
        let packet_id = 0x02;
        let payload = vec![0xAB; 512]; // Large payload
        let threshold = 256;

        let compressed = compress_packet(packet_id, &payload, threshold);
        let (dec_id, dec_payload, consumed) = decompress_packet(&compressed);

        assert_eq!(dec_id, packet_id);
        assert_eq!(dec_payload, payload);
        assert_eq!(consumed, compressed.len());
    }

    #[test]
    fn test_below_threshold_has_zero_data_length() {
        let compressed = compress_packet(0x00, b"hi", 256);
        // Skip packet_length varint
        let (_, plen_size) = read_varint(&compressed);
        // Read data_length — should be 0
        let (data_length, _) = read_varint(&compressed[plen_size..]);
        assert_eq!(data_length, 0);
    }

    #[test]
    fn test_above_threshold_has_nonzero_data_length() {
        let payload = vec![0xFF; 300];
        let compressed = compress_packet(0x02, &payload, 256);
        let (_, plen_size) = read_varint(&compressed);
        let (data_length, _) = read_varint(&compressed[plen_size..]);
        // data_length should be the uncompressed size of (varint packet_id + payload)
        assert!(data_length > 0);
    }
}

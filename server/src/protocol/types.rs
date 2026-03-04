/// Read a VarInt from the start of `data`. Returns (value, bytes_consumed).
pub fn read_varint(data: &[u8]) -> (i32, usize) {
    let mut value: i32 = 0;
    let mut position: u32 = 0;
    for (i, &byte) in data.iter().enumerate() {
        value |= ((byte & 0x7F) as i32) << position;
        if byte & 0x80 == 0 {
            return (value, i + 1);
        }
        position += 7;
        if position >= 32 {
            panic!("VarInt too big");
        }
    }
    panic!("VarInt not terminated");
}

/// Encode an i32 as a VarInt.
pub fn write_varint(mut value: i32) -> Vec<u8> {
    let mut buf = Vec::new();
    loop {
        let mut byte = (value & 0x7F) as u8;
        value = ((value as u32) >> 7) as i32;
        if value != 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if value == 0 {
            break;
        }
    }
    buf
}

/// Read a Minecraft protocol string (VarInt length prefix + UTF-8 bytes).
pub fn read_string(data: &[u8]) -> (String, usize) {
    let (len, offset) = read_varint(data);
    let len = len as usize;
    let s = String::from_utf8(data[offset..offset + len].to_vec()).expect("invalid UTF-8");
    (s, offset + len)
}

/// Write a Minecraft protocol string.
pub fn write_string(value: &str) -> Vec<u8> {
    let bytes = value.as_bytes();
    let mut buf = write_varint(bytes.len() as i32);
    buf.extend_from_slice(bytes);
    buf
}

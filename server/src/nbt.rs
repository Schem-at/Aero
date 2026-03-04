/// Lightweight network NBT encoder for Minecraft 1.20.2+ (no root compound name).
///
/// Network NBT format: TAG_Compound (0x0A) without a name length/string prefix,
/// followed by named tags, terminated by TAG_End (0x00).

const TAG_END: u8 = 0x00;
const TAG_BYTE: u8 = 0x01;
const TAG_SHORT: u8 = 0x02;
const TAG_INT: u8 = 0x03;
const TAG_LONG: u8 = 0x04;
const TAG_FLOAT: u8 = 0x05;
const TAG_DOUBLE: u8 = 0x06;
const TAG_STRING: u8 = 0x08;
const TAG_LIST: u8 = 0x09;
const TAG_COMPOUND: u8 = 0x0A;
const TAG_LONG_ARRAY: u8 = 0x0C;

pub struct NbtWriter {
    buf: Vec<u8>,
}

impl NbtWriter {
    /// Create a new NbtWriter. Writes the root TAG_Compound (network format: no name).
    pub fn new() -> Self {
        let mut buf = Vec::new();
        buf.push(TAG_COMPOUND);
        NbtWriter { buf }
    }

    fn write_name(&mut self, name: &str) {
        let bytes = name.as_bytes();
        self.buf.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(bytes);
    }

    pub fn byte(&mut self, name: &str, val: i8) {
        self.buf.push(TAG_BYTE);
        self.write_name(name);
        self.buf.push(val as u8);
    }

    pub fn short(&mut self, name: &str, val: i16) {
        self.buf.push(TAG_SHORT);
        self.write_name(name);
        self.buf.extend_from_slice(&val.to_be_bytes());
    }

    pub fn int(&mut self, name: &str, val: i32) {
        self.buf.push(TAG_INT);
        self.write_name(name);
        self.buf.extend_from_slice(&val.to_be_bytes());
    }

    pub fn long(&mut self, name: &str, val: i64) {
        self.buf.push(TAG_LONG);
        self.write_name(name);
        self.buf.extend_from_slice(&val.to_be_bytes());
    }

    pub fn float(&mut self, name: &str, val: f32) {
        self.buf.push(TAG_FLOAT);
        self.write_name(name);
        self.buf.extend_from_slice(&val.to_be_bytes());
    }

    pub fn double(&mut self, name: &str, val: f64) {
        self.buf.push(TAG_DOUBLE);
        self.write_name(name);
        self.buf.extend_from_slice(&val.to_be_bytes());
    }

    pub fn string(&mut self, name: &str, val: &str) {
        self.buf.push(TAG_STRING);
        self.write_name(name);
        let bytes = val.as_bytes();
        self.buf.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(bytes);
    }

    pub fn begin_compound(&mut self, name: &str) {
        self.buf.push(TAG_COMPOUND);
        self.write_name(name);
    }

    pub fn end_compound(&mut self) {
        self.buf.push(TAG_END);
    }

    pub fn begin_list(&mut self, name: &str, element_type: u8, count: i32) {
        self.buf.push(TAG_LIST);
        self.write_name(name);
        self.buf.push(element_type);
        self.buf.extend_from_slice(&count.to_be_bytes());
    }

    pub fn long_array(&mut self, name: &str, data: &[i64]) {
        self.buf.push(TAG_LONG_ARRAY);
        self.write_name(name);
        self.buf.extend_from_slice(&(data.len() as i32).to_be_bytes());
        for &val in data {
            self.buf.extend_from_slice(&val.to_be_bytes());
        }
    }

    /// Finalize: write TAG_End for root compound and return the bytes.
    pub fn finish(mut self) -> Vec<u8> {
        self.buf.push(TAG_END);
        self.buf
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_compound() {
        let w = NbtWriter::new();
        let data = w.finish();
        // TAG_Compound + TAG_End
        assert_eq!(data, vec![0x0A, 0x00]);
    }

    #[test]
    fn test_byte_tag() {
        let mut w = NbtWriter::new();
        w.byte("test", 42);
        let data = w.finish();
        assert_eq!(data, vec![
            0x0A,                   // root compound
            0x01,                   // TAG_Byte
            0x00, 0x04,             // name length = 4
            b't', b'e', b's', b't', // name
            42,                     // value
            0x00,                   // TAG_End (root)
        ]);
    }

    #[test]
    fn test_nested_compound() {
        let mut w = NbtWriter::new();
        w.begin_compound("inner");
        w.int("value", 123);
        w.end_compound();
        let data = w.finish();

        let expected = vec![
            0x0A,                           // root compound
            0x0A,                           // TAG_Compound
            0x00, 0x05,                     // name "inner" length
            b'i', b'n', b'n', b'e', b'r',  // name
            0x03,                           // TAG_Int
            0x00, 0x05,                     // name "value" length
            b'v', b'a', b'l', b'u', b'e',  // name
            0x00, 0x00, 0x00, 123,          // int value
            0x00,                           // TAG_End (inner)
            0x00,                           // TAG_End (root)
        ];
        assert_eq!(data, expected);
    }

    #[test]
    fn test_string_tag() {
        let mut w = NbtWriter::new();
        w.string("msg", "hi");
        let data = w.finish();
        assert_eq!(data, vec![
            0x0A,                   // root compound
            0x08,                   // TAG_String
            0x00, 0x03,             // name length = 3
            b'm', b's', b'g',      // name
            0x00, 0x02,             // string length = 2
            b'h', b'i',            // string value
            0x00,                   // TAG_End
        ]);
    }

    #[test]
    fn test_list_tag() {
        let mut w = NbtWriter::new();
        w.begin_list("items", TAG_BYTE, 0);
        let data = w.finish();
        assert_eq!(data, vec![
            0x0A,                       // root compound
            0x09,                       // TAG_List
            0x00, 0x05,                 // name length
            b'i', b't', b'e', b'm', b's', // name
            0x01,                       // element type (byte)
            0x00, 0x00, 0x00, 0x00,     // count = 0
            0x00,                       // TAG_End
        ]);
    }

    #[test]
    fn test_long_array() {
        let mut w = NbtWriter::new();
        w.long_array("arr", &[1i64, 2]);
        let data = w.finish();
        assert_eq!(data[0], 0x0A); // root compound
        assert_eq!(data[1], TAG_LONG_ARRAY);
        // name "arr" = 3 bytes
        assert_eq!(data[2..4], [0x00, 0x03]);
        assert_eq!(&data[4..7], b"arr");
        // count = 2
        assert_eq!(data[7..11], [0x00, 0x00, 0x00, 0x02]);
        // value 1
        assert_eq!(data[11..19], 1i64.to_be_bytes());
        // value 2
        assert_eq!(data[19..27], 2i64.to_be_bytes());
        // TAG_End
        assert_eq!(data[27], 0x00);
    }

    #[test]
    fn test_float_and_double() {
        let mut w = NbtWriter::new();
        w.float("f", 1.5);
        w.double("d", 2.5);
        let data = w.finish();
        // Verify float tag
        assert_eq!(data[1], TAG_FLOAT);
        // Verify double tag comes after float
        let float_end = 1 + 2 + 1 + 4; // tag + name_len + "f" + f32
        assert_eq!(data[1 + float_end], TAG_DOUBLE);
    }
}

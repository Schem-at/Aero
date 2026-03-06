/// NBT encoder/decoder for Minecraft.
///
/// Supports both:
/// - Network format (1.20.2+): TAG_Compound without root name
/// - Java format (Anvil files): TAG_Compound with u16-length root name

const TAG_END: u8 = 0x00;
const TAG_BYTE: u8 = 0x01;
const TAG_SHORT: u8 = 0x02;
const TAG_INT: u8 = 0x03;
const TAG_LONG: u8 = 0x04;
const TAG_FLOAT: u8 = 0x05;
const TAG_DOUBLE: u8 = 0x06;
const TAG_BYTE_ARRAY: u8 = 0x07;
const TAG_STRING: u8 = 0x08;
const TAG_LIST: u8 = 0x09;
const TAG_COMPOUND: u8 = 0x0A;
const TAG_INT_ARRAY: u8 = 0x0B;
const TAG_LONG_ARRAY: u8 = 0x0C;

// ─── NbtValue (read side) ───────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum NbtValue {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<i8>),
    String(String),
    List(Vec<NbtValue>),
    Compound(Vec<(String, NbtValue)>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

#[derive(Debug)]
pub enum NbtError {
    UnexpectedEof,
    InvalidTagType(u8),
    InvalidUtf8,
    InvalidRootTag(u8),
}

impl std::fmt::Display for NbtError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NbtError::UnexpectedEof => write!(f, "unexpected end of NBT data"),
            NbtError::InvalidTagType(t) => write!(f, "invalid NBT tag type: {}", t),
            NbtError::InvalidUtf8 => write!(f, "invalid UTF-8 in NBT string"),
            NbtError::InvalidRootTag(t) => write!(f, "expected root compound, got tag {}", t),
        }
    }
}

impl NbtValue {
    /// Look up a field in a Compound by name.
    pub fn get(&self, name: &str) -> Option<&NbtValue> {
        match self {
            NbtValue::Compound(entries) => entries.iter().find(|(n, _)| n == name).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_byte(&self) -> Option<i8> {
        match self { NbtValue::Byte(v) => Some(*v), _ => None }
    }
    pub fn as_short(&self) -> Option<i16> {
        match self { NbtValue::Short(v) => Some(*v), _ => None }
    }
    pub fn as_int(&self) -> Option<i32> {
        match self { NbtValue::Int(v) => Some(*v), _ => None }
    }
    pub fn as_long(&self) -> Option<i64> {
        match self { NbtValue::Long(v) => Some(*v), _ => None }
    }
    pub fn as_float(&self) -> Option<f32> {
        match self { NbtValue::Float(v) => Some(*v), _ => None }
    }
    pub fn as_double(&self) -> Option<f64> {
        match self { NbtValue::Double(v) => Some(*v), _ => None }
    }
    pub fn as_string(&self) -> Option<&str> {
        match self { NbtValue::String(v) => Some(v), _ => None }
    }
    pub fn as_list(&self) -> Option<&[NbtValue]> {
        match self { NbtValue::List(v) => Some(v), _ => None }
    }
    pub fn as_compound(&self) -> Option<&[(String, NbtValue)]> {
        match self { NbtValue::Compound(v) => Some(v), _ => None }
    }
    pub fn as_byte_array(&self) -> Option<&[i8]> {
        match self { NbtValue::ByteArray(v) => Some(v), _ => None }
    }
    pub fn as_int_array(&self) -> Option<&[i32]> {
        match self { NbtValue::IntArray(v) => Some(v), _ => None }
    }
    pub fn as_long_array(&self) -> Option<&[i64]> {
        match self { NbtValue::LongArray(v) => Some(v), _ => None }
    }
}

// ─── NbtReader ──────────────────────────────────────────────────────────────

pub struct NbtReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> NbtReader<'a> {
    /// Parse Java NBT (Anvil files): TAG_Compound + u16 name length + name + payload.
    /// Returns (root_name, root_value).
    pub fn parse_java(data: &[u8]) -> Result<(String, NbtValue), NbtError> {
        let mut reader = NbtReader { data, pos: 0 };
        let tag_type = reader.read_u8()?;
        if tag_type != TAG_COMPOUND {
            return Err(NbtError::InvalidRootTag(tag_type));
        }
        let name = reader.read_string()?;
        let value = reader.read_compound()?;
        Ok((name, value))
    }

    /// Parse Network NBT (1.20.2+): TAG_Compound without root name.
    pub fn parse_network(data: &[u8]) -> Result<NbtValue, NbtError> {
        let mut reader = NbtReader { data, pos: 0 };
        let tag_type = reader.read_u8()?;
        if tag_type != TAG_COMPOUND {
            return Err(NbtError::InvalidRootTag(tag_type));
        }
        reader.read_compound()
    }

    fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    fn read_u8(&mut self) -> Result<u8, NbtError> {
        if self.remaining() < 1 { return Err(NbtError::UnexpectedEof); }
        let v = self.data[self.pos];
        self.pos += 1;
        Ok(v)
    }

    fn read_i8(&mut self) -> Result<i8, NbtError> {
        Ok(self.read_u8()? as i8)
    }

    fn read_i16(&mut self) -> Result<i16, NbtError> {
        if self.remaining() < 2 { return Err(NbtError::UnexpectedEof); }
        let v = i16::from_be_bytes([self.data[self.pos], self.data[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }

    fn read_i32(&mut self) -> Result<i32, NbtError> {
        if self.remaining() < 4 { return Err(NbtError::UnexpectedEof); }
        let v = i32::from_be_bytes(self.data[self.pos..self.pos + 4].try_into().unwrap());
        self.pos += 4;
        Ok(v)
    }

    fn read_i64(&mut self) -> Result<i64, NbtError> {
        if self.remaining() < 8 { return Err(NbtError::UnexpectedEof); }
        let v = i64::from_be_bytes(self.data[self.pos..self.pos + 8].try_into().unwrap());
        self.pos += 8;
        Ok(v)
    }

    fn read_f32(&mut self) -> Result<f32, NbtError> {
        Ok(f32::from_bits(self.read_i32()? as u32))
    }

    fn read_f64(&mut self) -> Result<f64, NbtError> {
        Ok(f64::from_bits(self.read_i64()? as u64))
    }

    fn read_string(&mut self) -> Result<String, NbtError> {
        let len = self.read_i16()? as usize;
        if self.remaining() < len { return Err(NbtError::UnexpectedEof); }
        let s = std::str::from_utf8(&self.data[self.pos..self.pos + len])
            .map_err(|_| NbtError::InvalidUtf8)?;
        self.pos += len;
        Ok(s.to_string())
    }

    fn read_payload(&mut self, tag_type: u8) -> Result<NbtValue, NbtError> {
        match tag_type {
            TAG_BYTE => Ok(NbtValue::Byte(self.read_i8()?)),
            TAG_SHORT => Ok(NbtValue::Short(self.read_i16()?)),
            TAG_INT => Ok(NbtValue::Int(self.read_i32()?)),
            TAG_LONG => Ok(NbtValue::Long(self.read_i64()?)),
            TAG_FLOAT => Ok(NbtValue::Float(self.read_f32()?)),
            TAG_DOUBLE => Ok(NbtValue::Double(self.read_f64()?)),
            TAG_BYTE_ARRAY => {
                let len = self.read_i32()? as usize;
                if self.remaining() < len { return Err(NbtError::UnexpectedEof); }
                let mut arr = Vec::with_capacity(len);
                for _ in 0..len {
                    arr.push(self.read_i8()?);
                }
                Ok(NbtValue::ByteArray(arr))
            }
            TAG_STRING => Ok(NbtValue::String(self.read_string()?)),
            TAG_LIST => {
                let elem_type = self.read_u8()?;
                let count = self.read_i32()? as usize;
                let mut items = Vec::with_capacity(count);
                for _ in 0..count {
                    items.push(self.read_payload(elem_type)?);
                }
                Ok(NbtValue::List(items))
            }
            TAG_COMPOUND => self.read_compound(),
            TAG_INT_ARRAY => {
                let len = self.read_i32()? as usize;
                let mut arr = Vec::with_capacity(len);
                for _ in 0..len {
                    arr.push(self.read_i32()?);
                }
                Ok(NbtValue::IntArray(arr))
            }
            TAG_LONG_ARRAY => {
                let len = self.read_i32()? as usize;
                let mut arr = Vec::with_capacity(len);
                for _ in 0..len {
                    arr.push(self.read_i64()?);
                }
                Ok(NbtValue::LongArray(arr))
            }
            other => Err(NbtError::InvalidTagType(other)),
        }
    }

    fn read_compound(&mut self) -> Result<NbtValue, NbtError> {
        let mut entries = Vec::new();
        loop {
            let tag_type = self.read_u8()?;
            if tag_type == TAG_END {
                break;
            }
            let name = self.read_string()?;
            let value = self.read_payload(tag_type)?;
            entries.push((name, value));
        }
        Ok(NbtValue::Compound(entries))
    }
}

// ─── NbtWriter ──────────────────────────────────────────────────────────────

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

    /// Create a new NbtWriter in Java format: TAG_Compound + u16(0) empty root name.
    pub fn new_java() -> Self {
        let mut buf = Vec::new();
        buf.push(TAG_COMPOUND);
        buf.extend_from_slice(&0u16.to_be_bytes()); // empty root name
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

    pub fn byte_array(&mut self, name: &str, data: &[i8]) {
        self.buf.push(TAG_BYTE_ARRAY);
        self.write_name(name);
        self.buf.extend_from_slice(&(data.len() as i32).to_be_bytes());
        for &b in data {
            self.buf.push(b as u8);
        }
    }

    pub fn int_array(&mut self, name: &str, data: &[i32]) {
        self.buf.push(TAG_INT_ARRAY);
        self.write_name(name);
        self.buf.extend_from_slice(&(data.len() as i32).to_be_bytes());
        for &val in data {
            self.buf.extend_from_slice(&val.to_be_bytes());
        }
    }

    pub fn long_array(&mut self, name: &str, data: &[i64]) {
        self.buf.push(TAG_LONG_ARRAY);
        self.write_name(name);
        self.buf.extend_from_slice(&(data.len() as i32).to_be_bytes());
        for &val in data {
            self.buf.extend_from_slice(&val.to_be_bytes());
        }
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

    /// Write a raw list element string (no tag type/name prefix, just u16 len + bytes).
    pub fn list_string_element(&mut self, val: &str) {
        let bytes = val.as_bytes();
        self.buf.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
        self.buf.extend_from_slice(bytes);
    }

    /// Write a raw list element compound start (just the entries, no tag prefix).
    /// End with `end_compound()`.
    pub fn list_compound_start(&mut self) {
        // compounds in lists don't have a tag type or name prefix
    }

    /// Finalize: write TAG_End for root compound and return the bytes.
    pub fn finish(mut self) -> Vec<u8> {
        self.buf.push(TAG_END);
        self.buf
    }
}

// ─── NbtValue → bytes (for writing parsed values back) ─────────────────────

impl NbtValue {
    /// Encode this value as Java NBT bytes (with empty root name for compounds).
    pub fn to_java_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        match self {
            NbtValue::Compound(_) => {
                buf.push(TAG_COMPOUND);
                buf.extend_from_slice(&0u16.to_be_bytes()); // empty root name
                Self::write_compound_payload(self, &mut buf);
            }
            _ => panic!("Root NBT value must be a Compound"),
        }
        buf
    }

    fn write_tag(name: &str, value: &NbtValue, buf: &mut Vec<u8>) {
        let tag_type = value.tag_type();
        buf.push(tag_type);
        let name_bytes = name.as_bytes();
        buf.extend_from_slice(&(name_bytes.len() as u16).to_be_bytes());
        buf.extend_from_slice(name_bytes);
        Self::write_payload(value, buf);
    }

    fn write_payload(value: &NbtValue, buf: &mut Vec<u8>) {
        match value {
            NbtValue::Byte(v) => buf.push(*v as u8),
            NbtValue::Short(v) => buf.extend_from_slice(&v.to_be_bytes()),
            NbtValue::Int(v) => buf.extend_from_slice(&v.to_be_bytes()),
            NbtValue::Long(v) => buf.extend_from_slice(&v.to_be_bytes()),
            NbtValue::Float(v) => buf.extend_from_slice(&v.to_be_bytes()),
            NbtValue::Double(v) => buf.extend_from_slice(&v.to_be_bytes()),
            NbtValue::ByteArray(v) => {
                buf.extend_from_slice(&(v.len() as i32).to_be_bytes());
                for &b in v { buf.push(b as u8); }
            }
            NbtValue::String(v) => {
                let bytes = v.as_bytes();
                buf.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
                buf.extend_from_slice(bytes);
            }
            NbtValue::List(items) => {
                if items.is_empty() {
                    buf.push(TAG_END);
                    buf.extend_from_slice(&0i32.to_be_bytes());
                } else {
                    buf.push(items[0].tag_type());
                    buf.extend_from_slice(&(items.len() as i32).to_be_bytes());
                    for item in items {
                        Self::write_payload(item, buf);
                    }
                }
            }
            NbtValue::Compound(_) => Self::write_compound_payload(value, buf),
            NbtValue::IntArray(v) => {
                buf.extend_from_slice(&(v.len() as i32).to_be_bytes());
                for &val in v { buf.extend_from_slice(&val.to_be_bytes()); }
            }
            NbtValue::LongArray(v) => {
                buf.extend_from_slice(&(v.len() as i32).to_be_bytes());
                for &val in v { buf.extend_from_slice(&val.to_be_bytes()); }
            }
        }
    }

    fn write_compound_payload(value: &NbtValue, buf: &mut Vec<u8>) {
        if let NbtValue::Compound(entries) = value {
            for (name, val) in entries {
                Self::write_tag(name, val, buf);
            }
            buf.push(TAG_END);
        }
    }

    fn tag_type(&self) -> u8 {
        match self {
            NbtValue::Byte(_) => TAG_BYTE,
            NbtValue::Short(_) => TAG_SHORT,
            NbtValue::Int(_) => TAG_INT,
            NbtValue::Long(_) => TAG_LONG,
            NbtValue::Float(_) => TAG_FLOAT,
            NbtValue::Double(_) => TAG_DOUBLE,
            NbtValue::ByteArray(_) => TAG_BYTE_ARRAY,
            NbtValue::String(_) => TAG_STRING,
            NbtValue::List(_) => TAG_LIST,
            NbtValue::Compound(_) => TAG_COMPOUND,
            NbtValue::IntArray(_) => TAG_INT_ARRAY,
            NbtValue::LongArray(_) => TAG_LONG_ARRAY,
        }
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

    // ─── Reader tests ───────────────────────────────────────────────────

    #[test]
    fn test_read_network_empty_compound() {
        let data = vec![0x0A, 0x00]; // TAG_Compound + TAG_End
        let val = NbtReader::parse_network(&data).unwrap();
        assert_eq!(val, NbtValue::Compound(vec![]));
    }

    #[test]
    fn test_read_network_byte() {
        let mut w = NbtWriter::new();
        w.byte("x", -5);
        let data = w.finish();
        let val = NbtReader::parse_network(&data).unwrap();
        assert_eq!(val.get("x").unwrap().as_byte(), Some(-5));
    }

    #[test]
    fn test_read_network_all_primitives() {
        let mut w = NbtWriter::new();
        w.byte("b", 1);
        w.short("s", 300);
        w.int("i", 100000);
        w.long("l", 9999999999);
        w.float("f", 3.14);
        w.double("d", 2.71828);
        w.string("str", "hello");
        let data = w.finish();

        let val = NbtReader::parse_network(&data).unwrap();
        assert_eq!(val.get("b").unwrap().as_byte(), Some(1));
        assert_eq!(val.get("s").unwrap().as_short(), Some(300));
        assert_eq!(val.get("i").unwrap().as_int(), Some(100000));
        assert_eq!(val.get("l").unwrap().as_long(), Some(9999999999));
        assert!((val.get("f").unwrap().as_float().unwrap() - 3.14).abs() < 0.001);
        assert!((val.get("d").unwrap().as_double().unwrap() - 2.71828).abs() < 0.00001);
        assert_eq!(val.get("str").unwrap().as_string(), Some("hello"));
    }

    #[test]
    fn test_read_network_nested_compound() {
        let mut w = NbtWriter::new();
        w.begin_compound("inner");
        w.int("value", 42);
        w.end_compound();
        let data = w.finish();

        let val = NbtReader::parse_network(&data).unwrap();
        let inner = val.get("inner").unwrap();
        assert_eq!(inner.get("value").unwrap().as_int(), Some(42));
    }

    #[test]
    fn test_read_long_array() {
        let mut w = NbtWriter::new();
        w.long_array("arr", &[100, 200, 300]);
        let data = w.finish();

        let val = NbtReader::parse_network(&data).unwrap();
        assert_eq!(val.get("arr").unwrap().as_long_array(), Some(&[100i64, 200, 300][..]));
    }

    #[test]
    fn test_read_byte_array() {
        let mut w = NbtWriter::new();
        w.byte_array("ba", &[1, -1, 127, -128]);
        let data = w.finish();

        let val = NbtReader::parse_network(&data).unwrap();
        assert_eq!(val.get("ba").unwrap().as_byte_array(), Some(&[1i8, -1, 127, -128][..]));
    }

    #[test]
    fn test_read_int_array() {
        let mut w = NbtWriter::new();
        w.int_array("ia", &[10, 20, 30]);
        let data = w.finish();

        let val = NbtReader::parse_network(&data).unwrap();
        assert_eq!(val.get("ia").unwrap().as_int_array(), Some(&[10i32, 20, 30][..]));
    }

    #[test]
    fn test_read_list_of_compounds() {
        let mut w = NbtWriter::new();
        w.begin_list("items", TAG_COMPOUND, 2);
        // item 0
        w.int("id", 1);
        w.end_compound();
        // item 1
        w.int("id", 2);
        w.end_compound();
        let data = w.finish();

        let val = NbtReader::parse_network(&data).unwrap();
        let items = val.get("items").unwrap().as_list().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].get("id").unwrap().as_int(), Some(1));
        assert_eq!(items[1].get("id").unwrap().as_int(), Some(2));
    }

    #[test]
    fn test_java_format_roundtrip() {
        let mut w = NbtWriter::new_java();
        w.int("DataVersion", 4325);
        w.string("name", "test_chunk");
        let data = w.finish();

        let (root_name, val) = NbtReader::parse_java(&data).unwrap();
        assert_eq!(root_name, ""); // empty root name
        assert_eq!(val.get("DataVersion").unwrap().as_int(), Some(4325));
        assert_eq!(val.get("name").unwrap().as_string(), Some("test_chunk"));
    }

    #[test]
    fn test_nbtvalue_to_java_bytes_roundtrip() {
        let original = NbtValue::Compound(vec![
            ("DataVersion".to_string(), NbtValue::Int(4325)),
            ("pos".to_string(), NbtValue::IntArray(vec![1, 2, 3])),
            ("nested".to_string(), NbtValue::Compound(vec![
                ("x".to_string(), NbtValue::Byte(10)),
                ("arr".to_string(), NbtValue::LongArray(vec![100, 200])),
            ])),
            ("items".to_string(), NbtValue::List(vec![
                NbtValue::String("a".to_string()),
                NbtValue::String("b".to_string()),
            ])),
        ]);

        let bytes = original.to_java_bytes();
        let (name, parsed) = NbtReader::parse_java(&bytes).unwrap();
        assert_eq!(name, "");
        assert_eq!(parsed, original);
    }

    #[test]
    fn test_empty_list_roundtrip() {
        let original = NbtValue::Compound(vec![
            ("empty".to_string(), NbtValue::List(vec![])),
        ]);
        let bytes = original.to_java_bytes();
        let (_, parsed) = NbtReader::parse_java(&bytes).unwrap();
        assert_eq!(parsed, original);
    }
}

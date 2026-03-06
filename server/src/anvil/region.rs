/// Anvil region file header management.
///
/// Region file format:
/// - 4KB location table: 1024 entries of 4 bytes each (3 bytes offset, 1 byte sector count)
/// - 4KB timestamp table: 1024 entries of 4-byte big-endian unix timestamps
/// - Chunk data in 4KB sectors starting at sector 2
///
/// Each chunk entry in the data area:
/// - 4 bytes: big-endian data length (including compression type byte)
/// - 1 byte: compression type (2 = zlib)
/// - N bytes: compressed NBT data

const SECTOR_SIZE: usize = 4096;
const HEADER_SECTORS: usize = 2; // location table + timestamp table

pub struct RegionHeader {
    /// (sector_offset, sector_count) for each of 1024 chunks
    pub locations: [(u32, u8); 1024],
    /// Unix timestamps for each of 1024 chunks
    pub timestamps: [u32; 1024],
}

impl RegionHeader {
    /// Create a new empty region header.
    pub fn new() -> Self {
        RegionHeader {
            locations: [(0, 0); 1024],
            timestamps: [0; 1024],
        }
    }

    /// Parse from 8KB header bytes.
    pub fn from_bytes(data: &[u8]) -> Self {
        assert!(data.len() >= 8192, "region header must be at least 8192 bytes");
        let mut header = RegionHeader::new();

        for i in 0..1024 {
            let off = i * 4;
            let offset = ((data[off] as u32) << 16) | ((data[off + 1] as u32) << 8) | (data[off + 2] as u32);
            let count = data[off + 3];
            header.locations[i] = (offset, count);
        }

        for i in 0..1024 {
            let off = 4096 + i * 4;
            let ts = u32::from_be_bytes([data[off], data[off + 1], data[off + 2], data[off + 3]]);
            header.timestamps[i] = ts;
        }

        header
    }

    /// Serialize to 8KB header bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = vec![0u8; 8192];

        for i in 0..1024 {
            let (offset, count) = self.locations[i];
            let off = i * 4;
            buf[off] = ((offset >> 16) & 0xFF) as u8;
            buf[off + 1] = ((offset >> 8) & 0xFF) as u8;
            buf[off + 2] = (offset & 0xFF) as u8;
            buf[off + 3] = count;
        }

        for i in 0..1024 {
            let off = 4096 + i * 4;
            let ts = self.timestamps[i].to_be_bytes();
            buf[off..off + 4].copy_from_slice(&ts);
        }

        buf
    }

    /// Get the chunk index for local coordinates (0..31, 0..31).
    fn chunk_index(lx: usize, lz: usize) -> usize {
        (lz & 31) * 32 + (lx & 31)
    }

    /// Get the byte range for a chunk in the region file. Returns None if chunk not present.
    pub fn chunk_range(&self, lx: usize, lz: usize) -> Option<(usize, usize)> {
        let idx = Self::chunk_index(lx, lz);
        let (offset, count) = self.locations[idx];
        if offset == 0 && count == 0 {
            return None;
        }
        let start = offset as usize * SECTOR_SIZE;
        let len = count as usize * SECTOR_SIZE;
        Some((start, len))
    }

    /// Set the location for a chunk.
    pub fn set_chunk_location(&mut self, lx: usize, lz: usize, sector_offset: u32, sector_count: u8, timestamp: u32) {
        let idx = Self::chunk_index(lx, lz);
        self.locations[idx] = (sector_offset, sector_count);
        self.timestamps[idx] = timestamp;
    }

    /// Find the next free sector offset (append-only allocation).
    pub fn next_free_sector(&self) -> u32 {
        let mut max_end = HEADER_SECTORS as u32;
        for &(offset, count) in &self.locations {
            if offset > 0 {
                let end = offset + count as u32;
                if end > max_end {
                    max_end = end;
                }
            }
        }
        max_end
    }
}

/// Build a chunk entry for writing into a region file.
/// Returns the bytes to write (length prefix + compression type + compressed data),
/// padded to sector alignment.
pub fn build_chunk_entry(compressed_nbt: &[u8]) -> Vec<u8> {
    // data_length = compressed data length + 1 (compression type byte)
    let data_length = compressed_nbt.len() as u32 + 1;
    let mut entry = Vec::new();
    entry.extend_from_slice(&data_length.to_be_bytes());
    entry.push(2); // compression type 2 = zlib
    entry.extend_from_slice(compressed_nbt);

    // Pad to sector boundary
    let total = entry.len();
    let padded = ((total + SECTOR_SIZE - 1) / SECTOR_SIZE) * SECTOR_SIZE;
    entry.resize(padded, 0);
    entry
}

/// Parse a chunk entry from region file data. Returns the decompressed NBT bytes.
pub fn parse_chunk_entry(data: &[u8]) -> Result<Vec<u8>, super::AnvilError> {
    if data.len() < 5 {
        return Err(super::AnvilError::InvalidFormat("chunk entry too short".into()));
    }
    let data_length = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;
    let compression_type = data[4];
    if compression_type != 2 {
        return Err(super::AnvilError::InvalidFormat(
            format!("unsupported compression type: {}", compression_type),
        ));
    }
    if data.len() < 5 + data_length - 1 {
        return Err(super::AnvilError::InvalidFormat("chunk data truncated".into()));
    }
    let compressed = &data[5..5 + data_length as usize - 1];
    crate::compression::zlib_decompress(compressed).map_err(|e| e.into())
}

/// Calculate how many sectors a chunk entry needs.
pub fn sectors_needed(compressed_nbt_len: usize) -> u8 {
    let total = 4 + 1 + compressed_nbt_len; // length prefix + compression type + data
    ((total + SECTOR_SIZE - 1) / SECTOR_SIZE) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_header() {
        let h = RegionHeader::new();
        assert_eq!(h.locations[0], (0, 0));
        assert_eq!(h.timestamps[0], 0);
        assert!(h.chunk_range(0, 0).is_none());
    }

    #[test]
    fn test_header_roundtrip() {
        let mut h = RegionHeader::new();
        h.set_chunk_location(5, 10, 2, 3, 1234567890);
        h.set_chunk_location(0, 0, 5, 1, 9999);

        let bytes = h.to_bytes();
        assert_eq!(bytes.len(), 8192);

        let h2 = RegionHeader::from_bytes(&bytes);
        assert_eq!(h2.chunk_range(5, 10), Some((2 * 4096, 3 * 4096)));
        assert_eq!(h2.chunk_range(0, 0), Some((5 * 4096, 1 * 4096)));
        assert!(h2.chunk_range(1, 1).is_none());
        assert_eq!(h2.timestamps[RegionHeader::chunk_index(5, 10)], 1234567890);
    }

    #[test]
    fn test_next_free_sector() {
        let mut h = RegionHeader::new();
        assert_eq!(h.next_free_sector(), 2); // starts after header

        h.set_chunk_location(0, 0, 2, 3, 0);
        assert_eq!(h.next_free_sector(), 5);

        h.set_chunk_location(1, 0, 5, 2, 0);
        assert_eq!(h.next_free_sector(), 7);
    }

    #[test]
    fn test_build_and_parse_chunk_entry() {
        let original_data = b"hello world this is test nbt data";
        let compressed = crate::compression::zlib_compress(original_data);

        let entry = build_chunk_entry(&compressed);
        assert_eq!(entry.len() % 4096, 0); // sector aligned

        let decompressed = parse_chunk_entry(&entry).unwrap();
        assert_eq!(decompressed, original_data);
    }

    #[test]
    fn test_sectors_needed() {
        assert_eq!(sectors_needed(100), 1);     // 4+1+100 = 105 → 1 sector
        assert_eq!(sectors_needed(4090), 1);    // 4+1+4090 = 4095 → 1 sector
        assert_eq!(sectors_needed(4091), 1);    // 4+1+4091 = 4096 → 1 sector
        assert_eq!(sectors_needed(4092), 2);    // 4+1+4092 = 4097 → 2 sectors
    }
}

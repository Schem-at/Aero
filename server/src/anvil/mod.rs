pub mod region;
pub mod chunk_nbt;

#[derive(Debug)]
pub enum AnvilError {
    Nbt(crate::nbt::NbtError),
    Compression(std::io::Error),
    InvalidFormat(String),
}

impl From<crate::nbt::NbtError> for AnvilError {
    fn from(e: crate::nbt::NbtError) -> Self { AnvilError::Nbt(e) }
}

impl From<std::io::Error> for AnvilError {
    fn from(e: std::io::Error) -> Self { AnvilError::Compression(e) }
}

impl std::fmt::Display for AnvilError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AnvilError::Nbt(e) => write!(f, "NBT error: {}", e),
            AnvilError::Compression(e) => write!(f, "compression error: {}", e),
            AnvilError::InvalidFormat(s) => write!(f, "invalid anvil format: {}", s),
        }
    }
}

/// Compute region file name for a chunk position.
pub fn region_filename(cx: i32, cz: i32) -> String {
    let rx = cx.div_euclid(32);
    let rz = cz.div_euclid(32);
    format!("r.{}.{}.mca", rx, rz)
}

/// Compute the local chunk coordinates within a region (0..31).
pub fn local_coords(cx: i32, cz: i32) -> (usize, usize) {
    let lx = cx.rem_euclid(32) as usize;
    let lz = cz.rem_euclid(32) as usize;
    (lx, lz)
}

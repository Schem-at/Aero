use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub motd: String,
    pub max_players: u32,
    pub version_name: String,
    #[serde(default)]
    pub favicon: Option<String>,
    #[serde(default)]
    pub whitelist_enabled: bool,
    #[serde(default)]
    pub whitelist: Vec<String>,
    #[serde(default = "default_render_distance")]
    pub render_distance: u8,
    #[serde(default = "default_fog_color")]
    pub fog_color: i32,
    #[serde(default = "default_sky_color")]
    pub sky_color: i32,
    #[serde(default = "default_cloud_color")]
    pub cloud_color: i32,
    #[serde(default = "default_cloud_height")]
    pub cloud_height: f64,
}

fn default_render_distance() -> u8 { 10 }
fn default_fog_color() -> i32 { 12638463 }  // 0xC0D8FF
fn default_sky_color() -> i32 { 7907327 }   // 0x78A7FF
fn default_cloud_color() -> i32 { 16777215 } // 0xFFFFFF (white)
fn default_cloud_height() -> f64 { 192.33 }

impl Default for ServerConfig {
    fn default() -> Self {
        ServerConfig {
            motd: "A Minecraft server in your browser!".to_string(),
            max_players: 20,
            version_name: "WASM 1.21".to_string(),
            favicon: None,
            whitelist_enabled: false,
            whitelist: Vec::new(),
            render_distance: default_render_distance(),
            fog_color: default_fog_color(),
            sky_color: default_sky_color(),
            cloud_color: default_cloud_color(),
            cloud_height: default_cloud_height(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PacketTypeStats {
    pub count: u64,
    pub total_bytes: u64,
    pub total_processing_ns: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ConnectionStats {
    pub packets_in: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub per_packet_type: HashMap<String, PacketTypeStats>,
    pub tick_count: u64,
    pub tps: f32,
    pub mspt: f32,
    pub player_count: u32,
    pub connected_at_ms: f64,
}

const TICK_WINDOW: usize = 20;

#[derive(Debug, Clone)]
pub struct TickTracker {
    last_tick_ms: f64,
    recent_intervals: Vec<f64>,
    /// Accumulated processing time (ns) for packets in the current tick
    current_tick_ns: u64,
    /// Recent per-tick processing times (ms) for MSPT calculation
    recent_processing_ms: Vec<f64>,
}

impl TickTracker {
    pub fn new() -> Self {
        TickTracker {
            last_tick_ms: 0.0,
            recent_intervals: Vec::with_capacity(TICK_WINDOW),
            current_tick_ns: 0,
            recent_processing_ms: Vec::with_capacity(TICK_WINDOW),
        }
    }

    /// Call for every processed packet to accumulate processing time within the current tick.
    pub fn accumulate_processing(&mut self, ns: u64) {
        self.current_tick_ns += ns;
    }

    /// Call on Tick End. Returns (tps, mspt) where mspt is actual processing time used.
    pub fn record_tick(&mut self) -> (f32, f32) {
        let now = now_ms();

        // TPS: based on interval between ticks
        if self.last_tick_ms > 0.0 {
            let interval = now - self.last_tick_ms;
            if self.recent_intervals.len() >= TICK_WINDOW {
                self.recent_intervals.remove(0);
            }
            self.recent_intervals.push(interval);
        }
        self.last_tick_ms = now;

        // MSPT: actual processing time this tick
        let processing_ms = self.current_tick_ns as f64 / 1_000_000.0;
        self.current_tick_ns = 0;
        if self.recent_processing_ms.len() >= TICK_WINDOW {
            self.recent_processing_ms.remove(0);
        }
        self.recent_processing_ms.push(processing_ms);

        // Compute averages
        let tps = if self.recent_intervals.is_empty() {
            20.0
        } else {
            let avg_interval = self.recent_intervals.iter().sum::<f64>() / self.recent_intervals.len() as f64;
            (1000.0 / avg_interval).min(20.0)
        };

        let mspt = if self.recent_processing_ms.is_empty() {
            0.0
        } else {
            self.recent_processing_ms.iter().sum::<f64>() / self.recent_processing_ms.len() as f64
        };

        (tps as f32, mspt as f32)
    }

    pub fn reset(&mut self) {
        self.last_tick_ms = 0.0;
        self.recent_intervals.clear();
        self.current_tick_ns = 0;
        self.recent_processing_ms.clear();
    }
}

impl ConnectionStats {
    pub fn record_in(&mut self, packet_name: &str, bytes: u64, processing_ns: u64) {
        self.packets_in += 1;
        self.bytes_in += bytes;
        let entry = self.per_packet_type.entry(packet_name.to_string()).or_default();
        entry.count += 1;
        entry.total_bytes += bytes;
        entry.total_processing_ns += processing_ns;
    }

    pub fn record_out(&mut self, bytes: u64) {
        self.bytes_out += bytes;
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PacketLogEntry {
    pub direction: &'static str,
    pub state: String,
    pub packet_id: i32,
    pub packet_name: String,
    pub size: usize,
    pub hex_dump: String,
    pub raw_payload: String,
    pub timestamp_ms: f64,
    pub processing_ns: u64,
}

pub fn hex_dump(data: &[u8], max_bytes: usize) -> String {
    let limit = data.len().min(max_bytes);
    data[..limit]
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>()
        .join(" ")
}

const RING_BUFFER_CAP: usize = 200;

#[derive(Debug, Clone)]
pub struct PacketLog {
    entries: Vec<PacketLogEntry>,
}

impl PacketLog {
    pub fn new() -> Self {
        PacketLog {
            entries: Vec::with_capacity(RING_BUFFER_CAP),
        }
    }

    pub fn push(&mut self, entry: PacketLogEntry) {
        if self.entries.len() >= RING_BUFFER_CAP {
            self.entries.remove(0);
        }
        self.entries.push(entry);
    }

    pub fn drain_all(&mut self) -> Vec<PacketLogEntry> {
        std::mem::take(&mut self.entries)
    }

    pub fn entries(&self) -> &[PacketLogEntry] {
        &self.entries
    }
}

/// Get current timestamp in milliseconds.
/// In WASM, uses js_sys::Date::now(). Otherwise, returns 0 (standalone can override).
pub fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }
}

/// Simple nanosecond timer for measuring processing time.
/// Uses performance.now() in WASM, Instant in native.
pub struct Timer {
    #[cfg(target_arch = "wasm32")]
    start_ms: f64,
    #[cfg(not(target_arch = "wasm32"))]
    start: std::time::Instant,
}

impl Timer {
    pub fn start() -> Self {
        Timer {
            #[cfg(target_arch = "wasm32")]
            start_ms: {
                // performance.now() not easily available, use Date.now()
                js_sys::Date::now()
            },
            #[cfg(not(target_arch = "wasm32"))]
            start: std::time::Instant::now(),
        }
    }

    pub fn elapsed_ns(&self) -> u64 {
        #[cfg(target_arch = "wasm32")]
        {
            let elapsed_ms = js_sys::Date::now() - self.start_ms;
            (elapsed_ms * 1_000_000.0) as u64
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.start.elapsed().as_nanos() as u64
        }
    }
}

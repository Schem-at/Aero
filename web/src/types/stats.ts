export interface PacketTypeStats {
  count: number;
  total_bytes: number;
  total_processing_ns: number;
}

export interface ConnectionStats {
  packets_in: number;
  bytes_in: number;
  bytes_out: number;
  per_packet_type: Record<string, PacketTypeStats>;
  tick_count: number;
  tps: number;
  mspt: number;
  player_count: number;
  connected_at_ms: number;
}

export interface PacketLogEntry {
  direction: "in" | "out";
  state: string;
  packet_id: number;
  packet_name: string;
  size: number;
  hex_dump: string;
  raw_payload: string;
  timestamp_ms: number;
  processing_ns: number;
}

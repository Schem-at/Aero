import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { useServer } from "@/context/ServerContext";
import { useLogs } from "@/context/LogContext";
import {
  initWasm,
  setWasmLogCallback,
  handlePacket,
  resetState,
  isInitialized,
  setServerConfig,
} from "@/lib/wasm";
import { useServerConfig } from "@/context/ServerConfigContext";
import { WebTransportClient } from "@/lib/transport";
import { Play, Square, Send } from "lucide-react";

// Build a test handshake + status request packet sequence
function buildTestPackets(): Uint8Array {
  // Handshake packet: packet_id=0x00
  // protocol_version=767 (1.21), address="localhost", port=25565, next_state=1 (status)
  const handshakePayload = new Uint8Array([
    0xff, 0x05, // protocol_version as varint (767)
    0x09, // string length (9)
    0x6c, 0x6f, 0x63, 0x61, 0x6c, 0x68, 0x6f, 0x73, 0x74, // "localhost"
    0x63, 0xdd, // port 25565 big-endian
    0x01, // next_state = 1 (status)
  ]);

  // Frame: [varint length][varint packet_id][payload]
  const handshakeId = new Uint8Array([0x00]);
  const handshakeLen = handshakePayload.length + handshakeId.length;
  const handshakeFrame = new Uint8Array([
    handshakeLen,
    ...handshakeId,
    ...handshakePayload,
  ]);

  // Status Request packet: packet_id=0x00, no payload
  const statusRequestFrame = new Uint8Array([0x01, 0x00]);

  // Ping packet: packet_id=0x01, payload=8 bytes (i64)
  const pingPayload = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x42]);
  const pingId = new Uint8Array([0x01]);
  const pingLen = pingPayload.length + pingId.length;
  const pingFrame = new Uint8Array([pingLen, ...pingId, ...pingPayload]);

  // Concatenate all packets
  const combined = new Uint8Array(
    handshakeFrame.length + statusRequestFrame.length + pingFrame.length
  );
  combined.set(handshakeFrame, 0);
  combined.set(statusRequestFrame, handshakeFrame.length);
  combined.set(pingFrame, handshakeFrame.length + statusRequestFrame.length);
  return combined;
}

export function ServerControls() {
  const { status, setStatus, setError } = useServer();
  const { addLog, clearLogs } = useLogs();
  const { config } = useServerConfig();
  const transportRef = useRef<WebTransportClient | null>(null);

  const handleStart = async () => {
    try {
      setStatus("initializing");
      addLog("info", "system", "Starting WASM server module...");

      setWasmLogCallback(addLog);
      await initWasm();
      setServerConfig(config);

      addLog("info", "system", "WASM server initialized, connecting WebTransport...");

      // Connect WebTransport to the Go proxy
      const transport = new WebTransportClient(addLog);
      await transport.connect("https://localhost:4433/connect");
      transportRef.current = transport;

      setStatus("running");
      addLog("info", "system", "Server running — accepting Minecraft connections");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      addLog("error", "system", `Failed to initialize: ${msg}`);
    }
  };

  const handleStop = () => {
    transportRef.current?.close();
    transportRef.current = null;
    setStatus("stopped");
    addLog("info", "system", "Server stopped");
    clearLogs();
  };

  const handleTestPacket = () => {
    if (!isInitialized()) {
      addLog("warn", "system", "Server not running — start it first");
      return;
    }

    addLog("info", "system", "Sending test SLP packet sequence...");
    resetState();

    const packets = buildTestPackets();
    const response = handlePacket(packets);
    addLog(
      "info",
      "system",
      `Got ${response.length} bytes response from WASM`
    );
  };

  const isRunning = status === "running";
  const isBusy = status === "initializing";

  return (
    <div className="flex items-center gap-2">
      {!isRunning ? (
        <Button onClick={handleStart} disabled={isBusy} size="sm">
          <Play className="h-4 w-4" />
          Start Server
        </Button>
      ) : (
        <Button onClick={handleStop} variant="destructive" size="sm">
          <Square className="h-4 w-4" />
          Stop
        </Button>
      )}
      <Button
        onClick={handleTestPacket}
        variant="outline"
        size="sm"
        disabled={!isRunning}
      >
        <Send className="h-4 w-4" />
        Send Test Packet
      </Button>
    </div>
  );
}

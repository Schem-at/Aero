import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useServer } from "@/context/ServerContext";
import { useStats } from "@/context/StatsContext";

const BOOT_LOGS = [
  { prefix: "ok", text: "wasm runtime initialized (aero_server.wasm)", color: "text-emerald-500" },
  { prefix: "ok", text: "webtransport session pool ready", color: "text-emerald-500" },
  { prefix: "load", text: "gpu compute pipeline created (wgsl shaders)", color: "text-amber-500" },
  { prefix: "ok", text: "tcp proxy bridge online :25565", color: "text-emerald-500" },
  { prefix: "info", text: "protocol 774 (minecraft 1.21.11)", color: "text-cyan-500" },
  { prefix: "ok", text: "all systems nominal", color: "text-emerald-500" },
];

interface TerminalLine {
  type: "input" | "output";
  text: string;
}

export function HeroSection({ navigate }: { navigate: (r: "server" | "proxy" | "servers") => void }) {
  const { isAuthenticated } = useAuth();
  const { status, assignedRoom } = useServer();
  const { stats } = useStats();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<TerminalLine[]>([]);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [promptActive, setPromptActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const runCommand = useCallback((cmd: string) => {
    const trimmed = cmd.trim().toLowerCase();
    if (!trimmed) return;

    const lines: TerminalLine[] = [{ type: "input", text: cmd.trim() }];
    setCmdHistory(prev => [cmd.trim(), ...prev]);
    setHistoryIdx(-1);

    switch (trimmed) {
      case "help":
        lines.push({ type: "output", text: "Available commands:" });
        lines.push({ type: "output", text: "  \x1bGhelp\x1bR      — show this message" });
        lines.push({ type: "output", text: "  \x1bGstatus\x1bR    — server & proxy status" });
        lines.push({ type: "output", text: "  \x1bGabout\x1bR     — what is Aero?" });
        lines.push({ type: "output", text: "  \x1bGgithub\x1bR    — open source repo" });
        lines.push({ type: "output", text: "  \x1bGserver\x1bR    — go to host page" });
        lines.push({ type: "output", text: "  \x1bGservers\x1bR   — browse public servers" });
        lines.push({ type: "output", text: "  \x1bGclear\x1bR     — clear terminal" });
        break;
      case "status": {
        const running = status === "running";
        lines.push({ type: "output", text: `server:  ${running ? `\x1bGrunning\x1bR (${assignedRoom || "unknown"})` : "\x1bYstopped\x1bR"}` });
        if (running && stats) {
          lines.push({ type: "output", text: `players: ${stats.player_count} online` });
        }
        fetch("/api/servers").then(r => r.json()).then((servers: any[]) => {
          setHistory(prev => [...prev, { type: "output", text: `public:  ${servers.length} server${servers.length !== 1 ? "s" : ""} listed` }]);
        }).catch(() => {
          setHistory(prev => [...prev, { type: "output", text: "public:  unavailable" }]);
        });
        break;
      }
      case "about":
        lines.push({ type: "output", text: "" });
        lines.push({ type: "output", text: "\x1bG      ███╗███████╗██████╗  ██████╗" });
        lines.push({ type: "output", text: "\x1bG     ████║██╔════╝██╔══██╗██╔═══██╗" });
        lines.push({ type: "output", text: "\x1bG    ██╔██║█████╗  ██████╔╝██║   ██║" });
        lines.push({ type: "output", text: "\x1bC   ██╔╝██║██╔══╝  ██╔══██╗██║   ██║" });
        lines.push({ type: "output", text: "\x1bC  ██╔╝ ██║███████╗██║  ██║╚██████╔╝" });
        lines.push({ type: "output", text: "\x1bC  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝" });
        lines.push({ type: "output", text: "" });
        lines.push({ type: "output", text: "  A full Minecraft server compiled to \x1bGWebAssembly\x1bR." });
        lines.push({ type: "output", text: "  Runs entirely in your browser, bridged to real" });
        lines.push({ type: "output", text: "  Java Edition clients via a \x1bCWebTransport\x1bR proxy." });
        lines.push({ type: "output", text: "" });
        lines.push({ type: "output", text: "  \x1bGRust\x1bR (WASM server)  \x1bCGo\x1bR (proxy bridge)  \x1bYWGSL\x1bR (GPU worldgen)" });
        lines.push({ type: "output", text: "" });
        lines.push({ type: "output", text: "  Protocol \x1bY774\x1bR · Minecraft \x1bY1.21.11\x1bR · Java Edition" });
        lines.push({ type: "output", text: "  github.com/schem-at/aero" });
        lines.push({ type: "output", text: "" });
        break;
      case "github":
        window.open("https://github.com/schem-at/aero", "_blank");
        lines.push({ type: "output", text: "Opening \x1bGgithub.com/schem-at/aero\x1bR ..." });
        break;
      case "server":
        navigate("server");
        return;
      case "servers":
        navigate("servers");
        return;
      case "proxy":
        if (isAuthenticated) navigate("proxy");
        else lines.push({ type: "output", text: "proxy: requires authentication" });
        break;
      case "clear":
        setHistory([]);
        setInput("");
        return;
      default:
        lines.push({ type: "output", text: `command not found: ${cmd.trim()}` });
        lines.push({ type: "output", text: "type 'help' for available commands" });
    }

    setHistory(prev => [...prev, ...lines]);
    setInput("");
  }, [status, assignedRoom, stats, isAuthenticated, navigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      runCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length > 0) {
        const next = Math.min(historyIdx + 1, cmdHistory.length - 1);
        setHistoryIdx(next);
        setInput(cmdHistory[next]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx > 0) {
        const next = historyIdx - 1;
        setHistoryIdx(next);
        setInput(cmdHistory[next]);
      } else {
        setHistoryIdx(-1);
        setInput("");
      }
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [history]);

  return (
    <section className="min-h-screen bg-[#050505] p-4 md:p-8 flex items-center justify-center font-mono selection:bg-emerald-500/30 selection:text-emerald-200 relative overflow-hidden">

      {/* Background ambient logs */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none flex flex-col justify-center">
        <div
          className="absolute inset-0 z-10"
          style={{ background: 'radial-gradient(circle, transparent 10%, #050505 80%)' }}
        />
        <div className="animate-[scrollUp_40s_linear_infinite] space-y-2 flex flex-col opacity-[0.25]">
          {Array.from({ length: 30 }).map((_, i) => (
            <div key={i} className="text-[11px] leading-none text-zinc-600 whitespace-nowrap flex gap-8">
              {BOOT_LOGS.map((l, j) => (
                <span key={j}><span className={l.color}>[{l.prefix}]</span> {l.text}</span>
              ))}
              {BOOT_LOGS.map((l, j) => (
                <span key={j + 10}><span className={l.color}>[{l.prefix}]</span> {l.text}</span>
              ))}
              {BOOT_LOGS.map((l, j) => (
                <span key={j + 20}><span className={l.color}>[{l.prefix}]</span> {l.text}</span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Terminal Window */}
      <div className="relative z-10 w-full max-w-4xl border border-zinc-800/80 bg-[#0a0a0a]/95 backdrop-blur-xl rounded-lg shadow-[0_0_80px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden">

        {/* Title bar */}
        <div className="h-10 border-b border-zinc-800/80 bg-zinc-950/90 flex items-center px-4 justify-between shrink-0">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-zinc-800 hover:bg-red-500 transition-colors" />
            <div className="w-3 h-3 rounded-full bg-zinc-800 hover:bg-amber-500 transition-colors" />
            <div className="w-3 h-3 rounded-full bg-zinc-800 hover:bg-emerald-500 transition-colors" />
          </div>
          <div className="text-[10px] text-zinc-500 font-medium tracking-widest uppercase">sys_console ~ aero</div>
          <div className="w-14" />
        </div>

        {/* Content */}
        <div ref={scrollRef} className="p-6 md:p-10 text-sm text-zinc-300 overflow-y-auto max-h-[80vh]">
          <div className="animate-[fadeIn_0.5s_ease-out]">

            {/* Title */}
            <div className="mb-10 pl-2">
              <div className="mb-6">
                <pre className="text-emerald-400 font-black leading-[1.1] tracking-tight text-[10px] sm:text-xs md:text-[15px] drop-shadow-[0_0_15px_rgba(52,211,153,0.2)] m-0 p-0">
<span className="text-emerald-300 animate-pulse drop-shadow-[0_0_10px_rgba(52,211,153,0.8)]">{"      ███╗"}</span>{"███████╗██████╗  ██████╗\n"}
<span className="text-emerald-300 animate-pulse drop-shadow-[0_0_10px_rgba(52,211,153,0.8)]">{"     ████║"}</span>{"██╔════╝██╔══██╗██╔═══██╗\n"}
<span className="text-emerald-300 animate-pulse drop-shadow-[0_0_10px_rgba(52,211,153,0.8)]">{"    ██╔██║"}</span>{"█████╗  ██████╔╝██║   ██║\n"}
<span className="text-emerald-300 animate-pulse drop-shadow-[0_0_10px_rgba(52,211,153,0.8)]">{"   ██╔╝██║"}</span>{"██╔══╝  ██╔══██╗██║   ██║\n"}
<span className="text-emerald-300 animate-pulse drop-shadow-[0_0_10px_rgba(52,211,153,0.8)]">{"  ██╔╝ ██║"}</span>{"███████╗██║  ██║╚██████╔╝\n"}
<span className="text-emerald-300 animate-pulse drop-shadow-[0_0_10px_rgba(52,211,153,0.8)]">{"  ╚═╝  ╚═╝"}</span>{"╚══════╝╚═╝  ╚═╝ ╚═════╝  "}
                </pre>
              </div>
              <div className="text-zinc-400 max-w-xl leading-relaxed text-xs md:text-sm border-l-2 border-zinc-800 pl-4 mt-4">
                A full Minecraft server compiled to WebAssembly. Runs in a dedicated Web Worker, bridged to real Java Edition clients via a WebTransport proxy.
              </div>
            </div>

            {/* Structured Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-10 mb-12 pl-2">

              {/* Architecture Block */}
              <div>
                <div className="text-zinc-100 font-bold mb-4 uppercase tracking-widest text-xs border-b border-zinc-800 pb-2 flex items-center gap-2">
                  <span className="text-zinc-500">::</span> Architecture
                </div>
                <div className="space-y-4 font-mono text-xs">
                  <div className="flex flex-col gap-1">
                    <span className="text-emerald-400 font-bold">● WASM_SERVER <span className="text-zinc-600 font-normal ml-2">(Rust)</span></span>
                    <span className="text-zinc-500">Protocol implementation running in browser</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-cyan-400 font-bold">● PROXY_BRIDGE <span className="text-zinc-600 font-normal ml-2">(Go)</span></span>
                    <span className="text-zinc-500">QUIC/H3 streams to TCP connection</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-amber-400 font-bold">● GPU_WORLDGEN <span className="text-zinc-600 font-normal ml-2">(WGSL)</span></span>
                    <span className="text-zinc-500">Compute shader terrain generation</span>
                  </div>
                </div>
              </div>

              {/* Topology Block */}
              <div>
                <div className="text-zinc-100 font-bold mb-4 uppercase tracking-widest text-xs border-b border-zinc-800 pb-2 flex items-center gap-2">
                  <span className="text-zinc-500">::</span> Network Topology
                </div>
                <div className="font-mono text-xs text-zinc-400 space-y-2 relative before:absolute before:inset-y-0 before:left-4 before:border-l before:border-dashed before:border-zinc-800 before:z-0">
                  <div className="flex items-center gap-4 relative z-10">
                    <div className="w-8 h-8 rounded bg-zinc-900 border border-emerald-500/30 flex items-center justify-center shrink-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-emerald-400 font-bold">Browser (WASM)</span>
                      <span className="text-[10px] text-zinc-600">WebTransport / WebSocket</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 relative z-10 pt-2">
                    <div className="w-8 h-8 rounded bg-zinc-900 border border-cyan-500/30 flex items-center justify-center shrink-0">
                      <span className="w-2 h-2 rounded-full bg-cyan-500" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-cyan-400 font-bold">Proxy (Go)</span>
                      <span className="text-[10px] text-zinc-600">TCP Bridge</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 relative z-10 pt-2">
                    <div className="w-8 h-8 rounded bg-zinc-900 border border-amber-500/30 flex items-center justify-center shrink-0">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-amber-400 font-bold">Client</span>
                      <span className="text-[10px] text-zinc-600">Java Edition</span>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-4 pl-2 mb-8">
              <button
                onClick={() => navigate("server")}
                className="group relative px-5 py-3 border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-emerald-500/50 transition-all text-left flex flex-col gap-1 w-full sm:w-auto min-w-[200px]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-zinc-300 font-bold text-xs group-hover:text-emerald-400 transition-colors">Launch Server</span>
                  <span className="text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">↵</span>
                </div>
                <span className="text-[10px] text-zinc-600">Initialize WASM engine</span>
              </button>

              <button
                onClick={() => navigate("servers")}
                className="group relative px-5 py-3 border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-amber-500/50 transition-all text-left flex flex-col gap-1 w-full sm:w-auto min-w-[200px]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-zinc-300 font-bold text-xs group-hover:text-amber-400 transition-colors">Browse Servers</span>
                  <span className="text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">↵</span>
                </div>
                <span className="text-[10px] text-zinc-600">Public server list</span>
              </button>

              {isAuthenticated && (
                <button
                  onClick={() => navigate("proxy")}
                  className="group relative px-5 py-3 border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-cyan-500/50 transition-all text-left flex flex-col gap-1 w-full sm:w-auto min-w-[200px]"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-300 font-bold text-xs group-hover:text-cyan-400 transition-colors">Proxy Dashboard</span>
                    <span className="text-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">↵</span>
                  </div>
                  <span className="text-[10px] text-zinc-600">Monitor network bridge</span>
                </button>
              )}
            </div>

            {/* Terminal history */}
            {history.map((line, i) => (
              <div key={i} className="pl-2">
                {line.type === "input" ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-emerald-500 font-bold">root@aero</span>
                    <span className="text-zinc-600">~</span>
                    <span className="text-zinc-400">$</span>
                    <span className="text-zinc-100">{line.text}</span>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-400 pl-4 whitespace-pre">
                    <TermOutput text={line.text} />
                  </div>
                )}
              </div>
            ))}

            {/* Interactive prompt */}
            <div
              className="flex items-center gap-2 pl-2 mt-2 cursor-text"
              onClick={() => { setPromptActive(true); inputRef.current?.focus(); }}
            >
              <span className="text-emerald-500 font-bold text-xs">root@aero</span>
              <span className="text-zinc-600 text-xs">~</span>
              <span className="text-zinc-400 text-xs">$</span>
              {promptActive ? (
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={() => { if (!input && history.length === 0) setPromptActive(false); }}
                  className="flex-1 bg-transparent text-xs text-zinc-100 outline-none caret-emerald-500"
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus
                />
              ) : (
                <span className="text-zinc-100 select-none animate-[pulse_1s_infinite]">_</span>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* Scroll hint */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 animate-bounce">
        <div className="w-5 h-8 rounded-full border-2 border-zinc-700 flex items-start justify-center p-1">
          <div className="w-1 h-2 bg-zinc-600 rounded-full animate-[scrollDot_1.5s_ease-in-out_infinite]" />
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scrollUp {
          from { transform: translateY(0); }
          to { transform: translateY(-50%); }
        }
        @keyframes scrollDot {
          0%, 100% { opacity: 0; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(6px); }
        }
      `}} />
    </section>
  );
}

/** Renders terminal output with inline color codes: \x1bG=green, \x1bY=yellow, \x1bC=cyan, \x1bR=reset */
function TermOutput({ text }: { text: string }) {
  if (!text.includes("\x1b")) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let current = "";
  let color = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\x1b" && i + 1 < text.length) {
      if (current) parts.push(<span key={parts.length} className={color}>{current}</span>);
      current = "";
      const code = text[i + 1];
      color = code === "G" ? "text-emerald-400" : code === "Y" ? "text-amber-400" : code === "C" ? "text-cyan-400" : "";
      i++;
    } else {
      current += text[i];
    }
  }
  if (current) parts.push(<span key={parts.length} className={color}>{current}</span>);
  return <>{parts}</>;
}

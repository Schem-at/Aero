import React from "react";
import { AeroLogo } from "@/components/AeroLogo";
import { useAuth } from "@/context/AuthContext";

const BOOT_LOGS = [
  { prefix: "ok", text: "wasm runtime initialized (aero_server.wasm)", color: "text-emerald-500" },
  { prefix: "ok", text: "webtransport session pool ready", color: "text-emerald-500" },
  { prefix: "load", text: "gpu compute pipeline created (wgsl shaders)", color: "text-amber-500" },
  { prefix: "ok", text: "tcp proxy bridge online :25580", color: "text-emerald-500" },
  { prefix: "info", text: "protocol 774 (minecraft 1.21.11)", color: "text-cyan-500" },
  { prefix: "ok", text: "all systems nominal", color: "text-emerald-500" },
];

export function LandingPage({ navigate }: { navigate: (r: "server" | "proxy" | "servers") => void }) {
  const { isAuthenticated } = useAuth();
  return (
    <div className="min-h-full bg-[#050505] p-4 md:p-8 flex items-center justify-center font-mono selection:bg-emerald-500/30 selection:text-emerald-200 relative overflow-hidden">
      
      {/* Background ambient logs */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none flex flex-col justify-center">
        {/* Radial fade so the center is clear for the terminal */}
        <div 
          className="absolute inset-0 z-10" 
          style={{ background: 'radial-gradient(circle, transparent 10%, #050505 80%)' }} 
        />
        {/* Repeating logs moving upwards */}
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
        <div className="p-6 md:p-10 text-sm text-zinc-300 overflow-y-auto max-h-[80vh]">
          <div className="animate-[fadeIn_0.5s_ease-out]">
            
            {/* Command run */}
            <div className="flex items-center gap-2 mb-8">
              <span className="text-emerald-500 font-bold">root@aero</span>
              <span className="text-zinc-600">~</span>
              <span className="text-zinc-400">$</span>
              <span className="text-zinc-100">./aero --status</span>
            </div>

            {/* Title */}
            <div className="mb-10 pl-2">
              <div className="flex items-center gap-4 text-emerald-400 font-black text-3xl md:text-5xl tracking-tighter mb-2 drop-shadow-[0_0_15px_rgba(52,211,153,0.2)]">
                <AeroLogo className="w-10 h-10 md:w-12 md:h-12" />
                AERO
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
                      <span className="text-[10px] text-zinc-600">WebTransport</span>
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

            {/* Action Prompt */}
            <div className="flex items-center gap-2 mb-6">
              <span className="text-emerald-500 font-bold">root@aero</span>
              <span className="text-zinc-600">~</span>
              <span className="text-zinc-400">$</span>
              <span className="text-zinc-100 select-none animate-[pulse_1s_infinite]">_</span>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 pl-2 pb-4">
              <button
                onClick={() => navigate("server")}
                className="group relative px-5 py-3 border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-emerald-500/50 transition-all text-left flex flex-col gap-1 w-full sm:w-auto min-w-[200px]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-zinc-300 font-bold text-xs group-hover:text-emerald-400 transition-colors">./launch_server.sh</span>
                  <span className="text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">↵</span>
                </div>
                <span className="text-[10px] text-zinc-600">Initialize WASM engine</span>
              </button>

              <button
                onClick={() => navigate("servers")}
                className="group relative px-5 py-3 border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-amber-500/50 transition-all text-left flex flex-col gap-1 w-full sm:w-auto min-w-[200px]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-zinc-300 font-bold text-xs group-hover:text-amber-400 transition-colors">./browse_servers.sh</span>
                  <span className="text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">↵</span>
                </div>
                <span className="text-[10px] text-zinc-600">Browse public servers</span>
              </button>

              {isAuthenticated && (
                <button
                  onClick={() => navigate("proxy")}
                  className="group relative px-5 py-3 border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-cyan-500/50 transition-all text-left flex flex-col gap-1 w-full sm:w-auto min-w-[200px]"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-300 font-bold text-xs group-hover:text-cyan-400 transition-colors">./proxy_dashboard.sh</span>
                    <span className="text-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">↵</span>
                  </div>
                  <span className="text-[10px] text-zinc-600">Monitor network bridge</span>
                </button>
              )}
            </div>

          </div>
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
      `}} />
    </div>
  );
}

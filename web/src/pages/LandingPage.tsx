import React from "react";
import {
  Terminal,
  Activity,
  Cpu,
  Globe,
  Zap,
  ArrowRight,
  ArrowDown,
  Box,
  Blocks,
} from "lucide-react";

export function LandingPage({
  navigate,
}: {
  navigate: (r: "server" | "proxy") => void;
}) {
  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100 overflow-x-hidden overflow-y-auto selection:bg-emerald-400/30 selection:text-emerald-100">
      {/* Noise texture overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-50 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />

      {/* Grid lines background */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      {/* Hero */}
      <section className="relative z-10 px-6 md:px-12 pt-16 md:pt-28 pb-24 max-w-6xl mx-auto">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 mb-10 border-2 border-zinc-600 bg-zinc-900 shadow-[4px_4px_0px_0px_#a1a1aa] text-zinc-300 text-xs font-bold uppercase tracking-[0.2em]">
          <div className="w-2 h-2 bg-emerald-400 animate-pulse" />
          WebAssembly + WebTransport
        </div>

        {/* Title */}
        <h1
          className="text-5xl md:text-7xl lg:text-[5.5rem] font-black leading-[0.95] tracking-tight mb-8"
          style={{ fontFamily: "'Instrument Sans', 'Inter', system-ui, sans-serif" }}
        >
          <span className="text-zinc-100">Minecraft</span>
          <br />
          <span className="text-zinc-100">In The </span>
          <span className="relative inline-block">
            <span className="relative z-10 text-zinc-950 px-3">Browser</span>
            <span className="absolute inset-0 bg-emerald-400 -skew-x-3 z-0" />
          </span>
        </h1>

        <p className="text-lg md:text-xl text-zinc-500 max-w-xl mb-12 leading-relaxed font-medium">
          A full Minecraft server compiled to WASM, running in a Web Worker,
          bridged to real clients via WebTransport. Zero install. Open a tab
          and play.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={() => navigate("server")}
            className="group relative flex items-center justify-center gap-3 px-8 py-4 bg-emerald-400 text-zinc-950 text-base font-black uppercase tracking-wider border-3 border-zinc-950 shadow-[6px_6px_0px_0px_#09090b] hover:shadow-[2px_2px_0px_0px_#09090b] hover:translate-x-1 hover:translate-y-1 active:shadow-none active:translate-x-1.5 active:translate-y-1.5 transition-all duration-100"
          >
            <Terminal className="w-5 h-5" strokeWidth={2.5} />
            Launch Server
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" strokeWidth={3} />
          </button>
          <button
            onClick={() => navigate("proxy")}
            className="group flex items-center justify-center gap-3 px-8 py-4 bg-zinc-900 text-zinc-200 text-base font-black uppercase tracking-wider border-2 border-zinc-600 shadow-[6px_6px_0px_0px_#3f3f46] hover:shadow-[2px_2px_0px_0px_#3f3f46] hover:translate-x-1 hover:translate-y-1 active:shadow-none active:translate-x-1.5 active:translate-y-1.5 transition-all duration-100"
          >
            <Activity className="w-5 h-5 text-emerald-400" strokeWidth={2.5} />
            Proxy Dashboard
          </button>
        </div>

        {/* Decorative block */}
        <div className="hidden md:block absolute top-16 right-12 lg:right-0">
          <div className="w-48 h-48 border-2 border-zinc-800 relative">
            <div className="absolute -top-2 -right-2 w-48 h-48 border-2 border-zinc-700" />
            <div className="absolute -top-4 -right-4 w-48 h-48 border-2 border-emerald-400/20" />
            <div className="absolute top-6 left-6 text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
              v0.1.0 // wasm
            </div>
            <Blocks className="absolute bottom-6 right-6 w-16 h-16 text-zinc-800" strokeWidth={1} />
          </div>
        </div>
      </section>

      {/* Scroll indicator */}
      <div className="relative z-10 flex justify-center pb-6">
        <div className="flex flex-col items-center gap-2 text-zinc-600">
          <span className="text-[10px] font-bold uppercase tracking-[0.3em]">Architecture</span>
          <ArrowDown className="w-4 h-4 animate-bounce" />
        </div>
      </div>

      {/* Divider */}
      <div className="relative z-10 mx-6 md:mx-12 border-t-2 border-zinc-800" />

      {/* Architecture Section */}
      <section className="relative z-10 px-6 md:px-12 py-20 max-w-6xl mx-auto">
        <div className="flex items-end gap-4 mb-14">
          <h2
            className="text-3xl md:text-5xl font-black tracking-tight leading-none"
            style={{ fontFamily: "'Instrument Sans', 'Inter', system-ui, sans-serif" }}
          >
            How It
            <br />
            <span className="text-emerald-400">Works</span>
          </h2>
          <div className="hidden sm:block flex-1 border-b-2 border-zinc-800 mb-2" />
          <span className="hidden sm:block text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600 mb-2">
            3 pillars
          </span>
        </div>

        {/* Tech pillars */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-20">
          <BrutalCard
            icon={<Cpu />}
            num="01"
            title="WASM Server"
            tag="Rust"
            description="Full Minecraft protocol implementation compiled to WebAssembly. Runs in a dedicated Web Worker — off the main thread, native speed."
            accent="emerald"
          />
          <BrutalCard
            icon={<Globe />}
            num="02"
            title="WebTransport"
            tag="Go"
            description="A Go proxy bridges the browser's QUIC-based WebTransport streams to standard TCP connections that real Minecraft clients expect."
            accent="cyan"
          />
          <BrutalCard
            icon={<Zap />}
            num="03"
            title="GPU World Gen"
            tag="WGSL"
            description="Procedural terrain generation runs as WGSL compute shaders on the GPU. Hundreds of chunks generated in milliseconds."
            accent="amber"
          />
        </div>

        {/* Data flow diagram */}
        <div className="mt-8 border-2 border-zinc-800 bg-zinc-950 p-6 md:p-12 relative overflow-hidden group shadow-[8px_8px_0px_0px_#18181b]">
          {/* Animated scanning line background */}
          <div className="absolute inset-0 opacity-[0.15] bg-[linear-gradient(transparent_50%,rgba(16,185,129,0.3)_50%)] bg-[length:100%_4px] animate-[scan_2s_linear_infinite] pointer-events-none" />
          
          {/* Label */}
          <div className="absolute -top-px -left-px px-4 py-1.5 bg-emerald-400 border-b-2 border-r-2 border-zinc-800 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-950 flex items-center gap-2 z-20">
            <Activity className="w-3 h-3 animate-pulse" />
            Live Network Topology
          </div>

          <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-4 mt-6">
            <FlowNode
              icon={<Terminal />}
              label="Browser"
              sub="WASM Server"
              accent="emerald"
            />
            <FlowEdge label="WebTransport" sublabel="QUIC / H3" color="emerald" />
            <FlowNode
              icon={<Activity />}
              label="Proxy"
              sub="Go Binary"
              accent="cyan"
            />
            <FlowEdge label="TCP" sublabel="Protocol 774" color="cyan" />
            <FlowNode
              icon={<Cpu />}
              label="Client"
              sub="Java Edition"
              accent="amber"
            />
          </div>
          
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes scan {
              0% { background-position: 0 0; }
              100% { background-position: 0 4px; }
            }
            @keyframes dash {
              to { stroke-dashoffset: -20; }
            }
          `}} />
        </div>
      </section>

      {/* Footer strip */}
      <div className="relative z-10 mx-6 md:mx-12 border-t-2 border-zinc-800" />
      <footer className="relative z-10 px-6 md:px-12 py-8 max-w-6xl mx-auto flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-700">
          Aero // Minecraft Web Server
        </span>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600">
            System Ready
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ─── Subcomponents ─── */

function BrutalCard({
  icon,
  num,
  title,
  tag,
  description,
  accent,
}: {
  icon: React.ReactNode;
  num: string;
  title: string;
  tag: string;
  description: string;
  accent: "emerald" | "cyan" | "amber";
}) {
  const accentMap = {
    emerald: {
      border: "border-emerald-400",
      text: "text-emerald-400",
      bg: "bg-emerald-400",
      shadow: "shadow-[6px_6px_0px_0px_#34d399]",
      hoverShadow: "hover:shadow-[3px_3px_0px_0px_#34d399]",
    },
    cyan: {
      border: "border-cyan-400",
      text: "text-cyan-400",
      bg: "bg-cyan-400",
      shadow: "shadow-[6px_6px_0px_0px_#22d3ee]",
      hoverShadow: "hover:shadow-[3px_3px_0px_0px_#22d3ee]",
    },
    amber: {
      border: "border-amber-400",
      text: "text-amber-400",
      bg: "bg-amber-400",
      shadow: "shadow-[6px_6px_0px_0px_#fbbf24]",
      hoverShadow: "hover:shadow-[3px_3px_0px_0px_#fbbf24]",
    },
  };

  const a = accentMap[accent];

  return (
    <div
      className={`group bg-zinc-900 border-2 border-zinc-700 p-6 relative ${a.shadow} ${a.hoverShadow} hover:translate-x-[3px] hover:translate-y-[3px] transition-all duration-100`}
    >
      {/* Number */}
      <span className="absolute top-4 right-5 text-[10px] font-mono font-bold text-zinc-700">
        {num}
      </span>

      {/* Icon block */}
      <div
        className={`w-12 h-12 border-2 ${a.border} flex items-center justify-center mb-5 ${a.text}`}
      >
        {React.cloneElement(icon as React.ReactElement<{ className?: string; strokeWidth?: number }>, {
          className: "w-6 h-6",
          strokeWidth: 2,
        })}
      </div>

      {/* Title + tag */}
      <div className="flex items-center gap-3 mb-3">
        <h3
          className="text-lg font-black tracking-tight"
          style={{ fontFamily: "'Instrument Sans', 'Inter', system-ui, sans-serif" }}
        >
          {title}
        </h3>
        <span
          className={`text-[9px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 ${a.bg} text-zinc-950`}
        >
          {tag}
        </span>
      </div>

      <p className="text-sm text-zinc-500 leading-relaxed font-medium">
        {description}
      </p>

      {/* Bottom accent bar */}
      <div className={`absolute bottom-0 left-0 w-full h-[3px] ${a.bg} scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-200`} />
    </div>
  );
}

function FlowNode({
  icon,
  label,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  accent: "emerald" | "cyan" | "amber";
}) {
  const colorMap = {
    emerald: "border-emerald-400 text-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.15)]",
    cyan: "border-cyan-400 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.15)]",
    amber: "border-amber-400 text-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.15)]",
  };

  const bgMap = {
    emerald: "bg-emerald-400/10",
    cyan: "bg-cyan-400/10",
    amber: "bg-amber-400/10",
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full lg:w-auto shrink-0 relative z-10 group">
      <div
        className={`w-20 h-20 border-2 ${colorMap[accent]} ${bgMap[accent]} flex items-center justify-center relative backdrop-blur-sm transition-transform duration-300 group-hover:scale-105`}
      >
        {/* Corner accents */}
        <div className={`absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 ${colorMap[accent].split(' ')[0]}`} />
        <div className={`absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 ${colorMap[accent].split(' ')[0]}`} />
        
        {React.cloneElement(icon as React.ReactElement<{ className?: string; strokeWidth?: number }>, {
          className: "w-8 h-8 drop-shadow-[0_0_8px_currentColor]",
          strokeWidth: 1.5,
        })}
      </div>
      <div className="text-center bg-zinc-950/80 px-3 py-1.5 border border-zinc-800 backdrop-blur-sm">
        <div className="text-sm font-black uppercase tracking-widest text-zinc-100">{label}</div>
        <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mt-0.5">
          {sub}
        </div>
      </div>
    </div>
  );
}

function FlowEdge({ label, sublabel, color }: { label: string; sublabel: string; color?: "emerald" | "cyan" | "amber" }) {
  const colorMap = {
    emerald: "stroke-emerald-400 text-emerald-400",
    cyan: "stroke-cyan-400 text-cyan-400",
    amber: "stroke-amber-400 text-amber-400",
  };
  
  const c = color ? colorMap[color] : "stroke-zinc-600 text-zinc-400";

  return (
    <div className="flex-1 flex flex-col items-center justify-center w-full lg:w-auto py-8 lg:py-0 relative min-w-[120px] z-0">
      {/* Horizontal SVG line with animated dash (desktop) */}
      <div className="hidden lg:block w-full absolute top-1/2 -translate-y-1/2 left-0 right-0">
        <svg width="100%" height="20" preserveAspectRatio="none">
          <line 
            x1="0" y1="10" x2="100%" y2="10" 
            className={`${c.split(' ')[0]}`} 
            strokeWidth="2" 
            strokeDasharray="4 6" 
            style={{ animation: 'dash 1s linear infinite' }}
          />
        </svg>
      </div>
      {/* Vertical line (mobile) */}
      <div className="flex lg:hidden h-16 absolute left-1/2 -translate-x-1/2 top-0 bottom-0">
        <svg width="20" height="100%" preserveAspectRatio="none">
          <line 
            x1="10" y1="0" x2="10" y2="100%" 
            className={`${c.split(' ')[0]}`} 
            strokeWidth="2" 
            strokeDasharray="4 6" 
            style={{ animation: 'dash 1s linear infinite' }}
          />
        </svg>
      </div>
      <div className="relative z-10 bg-zinc-950 px-4 py-2 border border-zinc-800 shadow-[0_0_15px_rgba(0,0,0,0.5)] flex flex-col items-center transition-colors">
        <span className={`text-[11px] font-black uppercase tracking-[0.15em] ${c.split(' ')[1]} drop-shadow-[0_0_4px_currentColor]`}>
          {label}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500 mt-0.5">
          {sublabel}
        </span>
      </div>
    </div>
  );
}

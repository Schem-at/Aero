import { useRef } from "react";
import { HeroSection } from "@/components/HeroSection";

const STEPS = [
  {
    num: "01",
    title: "Click start",
    desc: "Your browser boots a real Minecraft server. No downloads, no installs, no account needed.",
    color: "text-emerald-400",
    border: "border-emerald-500/20",
    glow: "bg-emerald-500",
  },
  {
    num: "02",
    title: "Share your link",
    desc: "You get a unique address like yourname.aero. Send it to friends — that's their server address in Minecraft.",
    color: "text-cyan-400",
    border: "border-cyan-500/20",
    glow: "bg-cyan-500",
  },
  {
    num: "03",
    title: "They join and play",
    desc: "Friends open regular Minecraft Java Edition, add your server, and connect. No mods, no plugins required on their end.",
    color: "text-amber-400",
    border: "border-amber-500/20",
    glow: "bg-amber-500",
  },
];

const FEATURES = [
  {
    label: "Your browser is the server",
    detail: "We compiled a full Minecraft server to run inside your browser tab. The game logic, world data, and player connections all happen right here — no renting a cloud box, no paying monthly fees.",
    accent: "text-emerald-400",
    accentBg: "bg-emerald-500/10",
    accentBorder: "border-emerald-500/20",
  },
  {
    label: "No port forwarding. Ever.",
    detail: "Aero handles the networking for you. Our relay connects your browser to real Minecraft clients over the internet. You don't need to touch your router, open ports, or understand NAT.",
    accent: "text-cyan-400",
    accentBg: "bg-cyan-500/10",
    accentBorder: "border-cyan-500/20",
  },
  {
    label: "Your graphics card builds the world",
    detail: "Terrain — mountains, caves, oceans — is generated on your GPU in parallel. Thousands of blocks calculated simultaneously, so new chunks appear almost instantly as you explore.",
    accent: "text-amber-400",
    accentBg: "bg-amber-500/10",
    accentBorder: "border-amber-500/20",
  },
  {
    label: "Real Minecraft. Real clients.",
    detail: "This isn't a web clone or a stripped-down demo. Players connect with their actual Minecraft Java Edition client. Same game, same experience — the server just happens to live in a browser.",
    accent: "text-violet-400",
    accentBg: "bg-violet-500/10",
    accentBorder: "border-violet-500/20",
  },
];

export function LandingPage({ navigate }: { navigate: (r: "server" | "proxy" | "servers") => void }) {
  const sectionsRef = useRef<HTMLDivElement>(null);

  return (
    <div className="h-full overflow-y-auto scroll-smooth bg-[#050505]">
      <HeroSection navigate={navigate} />

      <div ref={sectionsRef}>
        {/* How it works */}
        <section className="relative py-24 md:py-32 px-6 md:px-12">
          <div className="max-w-4xl mx-auto">
            <div className="mb-16">
              <p className="text-emerald-500 font-mono text-xs tracking-widest uppercase mb-3">How it works</p>
              <h2 className="text-2xl md:text-4xl font-bold text-zinc-100 leading-tight">
                Host a Minecraft server<br />
                <span className="text-zinc-500">in three steps.</span>
              </h2>
            </div>

            <div className="grid gap-8 md:gap-6">
              {STEPS.map((step) => (
                <div
                  key={step.num}
                  className={`group flex gap-6 md:gap-8 items-start p-6 rounded-lg border ${step.border} bg-zinc-950/50 hover:bg-zinc-900/50 transition-colors`}
                >
                  <div className="relative shrink-0">
                    <span className={`font-mono text-3xl md:text-4xl font-black ${step.color} opacity-30 group-hover:opacity-60 transition-opacity`}>
                      {step.num}
                    </span>
                    <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${step.glow} opacity-0 group-hover:opacity-100 transition-opacity`} />
                  </div>
                  <div>
                    <h3 className={`font-bold text-lg md:text-xl mb-2 ${step.color}`}>
                      {step.title}
                    </h3>
                    <p className="text-zinc-400 text-sm md:text-base leading-relaxed max-w-lg">
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Divider */}
        <div className="max-w-4xl mx-auto px-6 md:px-12">
          <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
        </div>

        {/* What makes it different */}
        <section className="py-24 md:py-32 px-6 md:px-12">
          <div className="max-w-4xl mx-auto">
            <div className="mb-16">
              <p className="text-cyan-500 font-mono text-xs tracking-widest uppercase mb-3">Under the hood</p>
              <h2 className="text-2xl md:text-4xl font-bold text-zinc-100 leading-tight">
                Not a gimmick.<br />
                <span className="text-zinc-500">Actually works.</span>
              </h2>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {FEATURES.map((f) => (
                <div
                  key={f.label}
                  className={`p-6 rounded-lg border ${f.accentBorder} ${f.accentBg} group hover:scale-[1.01] transition-transform`}
                >
                  <h3 className={`font-bold text-base md:text-lg mb-3 ${f.accent}`}>
                    {f.label}
                  </h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    {f.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Divider */}
        <div className="max-w-4xl mx-auto px-6 md:px-12">
          <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
        </div>

        {/* CTA */}
        <section className="py-24 md:py-32 px-6 md:px-12">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-2xl md:text-4xl font-bold text-zinc-100 mb-4">
              Ready to host?
            </h2>
            <p className="text-zinc-500 text-sm md:text-base mb-10 max-w-md mx-auto">
              No sign-up. No credit card. Just click start and you're running a Minecraft server.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => navigate("server")}
                className="px-8 py-3 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-sm rounded-md transition-colors"
              >
                Launch Server
              </button>
              <button
                onClick={() => navigate("servers")}
                className="px-8 py-3 border border-zinc-700 hover:border-zinc-500 text-zinc-300 font-bold text-sm rounded-md transition-colors"
              >
                Browse Public Servers
              </button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-900 py-8 px-6 md:px-12">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-600">
            <span className="font-mono">aero — open source minecraft hosting</span>
            <a
              href="https://github.com/schem-at/aero"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-400 transition-colors font-mono"
            >
              github.com/schem-at/aero
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

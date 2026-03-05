import React from "react";

export function AeroLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Main geometric 'A' chevron (Aerospace / Arrow) */}
      <path
        d="M12 2 L2 22 L7 22 L12 12 L17 22 L22 22 Z"
        fill="currentColor"
      />
      {/* Floating emerald core (WASM / Minecraft chunk) */}
      <rect
        x="10.5"
        y="15"
        width="3"
        height="3"
        className="fill-emerald-400 animate-pulse"
      />
      {/* Secondary trailing block (Network packet / Terminal trail) */}
      <rect
        x="11"
        y="20"
        width="2"
        height="2"
        className="fill-emerald-500/40"
      />
    </svg>
  );
}

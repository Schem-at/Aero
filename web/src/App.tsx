import { useState, useEffect, useCallback } from "react";
import { ServerPage } from "@/pages/ServerPage";
import { ProxyDashboard } from "@/pages/ProxyDashboard";
import { LandingPage } from "@/pages/LandingPage";
import { Server, Activity, Wind } from "lucide-react";

type Route = "" | "server" | "proxy";

function getRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash === "server" || hash === "proxy") return hash;
  return "";
}

export function App() {
  const [route, setRoute] = useState<Route>(getRoute);

  useEffect(() => {
    const onHash = () => setRoute(getRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((r: Route) => {
    window.location.hash = r ? `/${r}` : "/";
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <nav className="flex items-center justify-between px-5 py-2.5 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md z-50 flex-shrink-0">
        <button
          onClick={() => navigate("")}
          className="flex items-center gap-2.5 group"
        >
          <Wind className="h-5 w-5 text-emerald-400 transition-transform group-hover:rotate-12" />
          <span className="text-sm font-semibold tracking-tight text-zinc-100">
            Aero
          </span>
        </button>

        <div className="flex items-center gap-1">
          <NavLink
            active={route === "server"}
            onClick={() => navigate("server")}
            icon={<Server className="h-3.5 w-3.5" />}
          >
            Server
          </NavLink>
          <NavLink
            active={route === "proxy"}
            onClick={() => navigate("proxy")}
            icon={<Activity className="h-3.5 w-3.5" />}
          >
            Proxy
          </NavLink>
        </div>
      </nav>

      <main className="flex-1 min-h-0">
        {route === "" && <LandingPage navigate={navigate} />}
        {route === "server" && <ServerPage />}
        {route === "proxy" && <ProxyDashboard />}
      </main>
    </div>
  );
}

function NavLink({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active
          ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

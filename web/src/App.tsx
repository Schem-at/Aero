import { useState, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { ServerPage } from "@/pages/ServerPage";
import { ProxyDashboard } from "@/pages/ProxyDashboard";
import { LandingPage } from "@/pages/LandingPage";
import { LoginPage } from "@/pages/LoginPage";
import { ServersPage } from "@/pages/ServersPage";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Server, Activity, TerminalSquare, LogOut, Globe } from "lucide-react";
import { AeroLogo } from "@/components/AeroLogo";

type Route = "" | "server" | "proxy" | "servers";

function getRoute(): Route {
  const path = window.location.pathname.replace(/^\//, "");
  if (path === "server" || path === "proxy" || path === "servers") return path;
  return "";
}

export function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

function AppInner() {
  const [route, setRoute] = useState<Route>(getRoute);
  const { isAuthenticated, authDisabled, username, logout, loading } = useAuth();

  useEffect(() => {
    const onNav = () => {
      const nextRoute = getRoute();
      if (!document.startViewTransition) {
        setRoute(nextRoute);
        return;
      }
      document.startViewTransition(() => {
        flushSync(() => {
          setRoute(nextRoute);
        });
      });
    };
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  const navigate = useCallback((r: Route) => {
    const path = r ? `/${r}` : "/";
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[#050505] font-mono selection:bg-emerald-500/30 selection:text-emerald-200 text-zinc-300">
      <nav className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-zinc-800/80 bg-[#0a0a0a] z-50 flex-shrink-0 shadow-sm relative">
        {/* Subtle top highlight */}
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-zinc-700/50 to-transparent" />

        <button
          onClick={() => navigate("")}
          className="flex items-center gap-3 group"
        >
          <AeroLogo className="w-6 h-6 text-zinc-100 group-hover:text-emerald-400 transition-colors drop-shadow-[0_0_8px_rgba(52,211,153,0)] group-hover:drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
          <div className="flex flex-col text-left">
            <span className="text-sm font-bold tracking-widest text-zinc-100 uppercase leading-none">
              Aero
            </span>
            <span className="text-[9px] text-zinc-600 tracking-widest uppercase mt-0.5">
              Network Bridge
            </span>
          </div>
        </button>

        <div className="flex items-center gap-2 sm:gap-4">
          <NavLink
            active={route === ""}
            onClick={() => navigate("")}
            icon={<TerminalSquare className="h-3.5 w-3.5" />}
          >
            console
          </NavLink>
          <NavLink
            active={route === "server"}
            onClick={() => navigate("server")}
            icon={<Server className="h-3.5 w-3.5" />}
          >
            server
          </NavLink>
          <NavLink
            active={route === "servers"}
            onClick={() => navigate("servers")}
            icon={<Globe className="h-3.5 w-3.5" />}
          >
            servers
          </NavLink>
          {isAuthenticated && (
            <NavLink
              active={route === "proxy"}
              onClick={() => navigate("proxy")}
              icon={<Activity className="h-3.5 w-3.5" />}
            >
              proxy
            </NavLink>
          )}
          {isAuthenticated && !authDisabled && (
            <button
              onClick={logout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              title={`Signed in as ${username}`}
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{username}</span>
            </button>
          )}
        </div>
      </nav>

      <main className="flex-1 min-h-0 relative">
        {route === "" && <LandingPage navigate={navigate} />}
        {route === "server" && <ServerPage />}
        {route === "servers" && <ServersPage />}
        {route === "proxy" && (
          loading ? (
            <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
              Checking authentication...
            </div>
          ) : isAuthenticated ? (
            <ProxyDashboard />
          ) : (
            <LoginPage />
          )
        )}
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
      className={`group flex items-center gap-2 px-3 py-1.5 transition-all text-xs font-bold uppercase tracking-wider border-b-2 ${
        active
          ? "border-emerald-500 text-emerald-400 bg-emerald-500/5"
          : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 hover:border-zinc-700"
      }`}
    >
      <span className={active ? "text-emerald-500" : "text-zinc-600 group-hover:text-zinc-400 transition-colors"}>
        {icon}
      </span>
      <span className="hidden sm:inline-block">./{children}.sh</span>
      <span className="sm:hidden">{children}</span>
    </button>
  );
}
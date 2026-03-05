import { LogProvider } from "@/context/LogContext";
import { ServerProvider } from "@/context/ServerContext";
import { StatsProvider } from "@/context/StatsContext";
import { ServerConfigProvider } from "@/context/ServerConfigContext";
import { PluginProvider } from "@/context/PluginContext";
import { WorkerProvider } from "@/context/WorkerContext";
import { StatusBar } from "@/components/StatusBar";
import { ServerControls } from "@/components/ServerControls";
import { DevTools } from "@/components/DevTools";

export function ServerPage() {
  return (
    <ServerProvider>
      <LogProvider>
        <StatsProvider>
          <ServerConfigProvider>
            <PluginProvider>
              <WorkerProvider>
                <div className="flex flex-col h-full p-4 gap-4 max-w-4xl mx-auto">
                  <header className="flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-3">
                      <h1 className="text-lg font-semibold tracking-tight">
                        Server Console
                      </h1>
                      <StatusBar />
                    </div>
                    <ServerControls />
                  </header>
                  <DevTools />
                </div>
              </WorkerProvider>
            </PluginProvider>
          </ServerConfigProvider>
        </StatsProvider>
      </LogProvider>
    </ServerProvider>
  );
}

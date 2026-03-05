import { StatusBar } from "@/components/StatusBar";
import { ServerControls } from "@/components/ServerControls";
import { DevTools } from "@/components/DevTools";

export function ServerPage() {
  return (
    <div className="flex flex-col h-full p-2 sm:p-4 gap-2 sm:gap-4 max-w-4xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight shrink-0">
            Server
          </h1>
          <StatusBar />
        </div>
        <ServerControls />
      </header>
      <DevTools />
    </div>
  );
}

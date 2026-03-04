import { Button } from "@/components/ui/button";
import { useServer } from "@/context/ServerContext";
import { useWorker } from "@/context/WorkerContext";
import { Play, Square } from "lucide-react";

export function ServerControls() {
  const { status } = useServer();
  const { start, stop } = useWorker();

  const isRunning = status === "running";
  const isBusy = status === "initializing";

  return (
    <div className="flex items-center gap-2">
      {!isRunning ? (
        <Button onClick={start} disabled={isBusy} size="sm">
          <Play className="h-4 w-4" />
          Start Server
        </Button>
      ) : (
        <Button onClick={stop} variant="destructive" size="sm">
          <Square className="h-4 w-4" />
          Stop
        </Button>
      )}
    </div>
  );
}

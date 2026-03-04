import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export type ServerStatus = "stopped" | "initializing" | "running" | "error";

interface ServerContextValue {
  status: ServerStatus;
  setStatus: (status: ServerStatus) => void;
  errorMessage: string | null;
  setError: (message: string) => void;
}

const ServerContext = createContext<ServerContextValue | null>(null);

export function ServerProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ServerStatus>("stopped");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSetStatus = useCallback((s: ServerStatus) => {
    setStatus(s);
    if (s !== "error") setErrorMessage(null);
  }, []);

  const setError = useCallback((message: string) => {
    setStatus("error");
    setErrorMessage(message);
  }, []);

  return (
    <ServerContext.Provider
      value={{
        status,
        setStatus: handleSetStatus,
        errorMessage,
        setError,
      }}
    >
      {children}
    </ServerContext.Provider>
  );
}

export function useServer() {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error("useServer must be used within ServerProvider");
  return ctx;
}

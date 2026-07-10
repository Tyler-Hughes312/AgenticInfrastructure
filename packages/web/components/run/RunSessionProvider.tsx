"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useRunSession } from "../../hooks/useRunSession";

type RunSessionValue = ReturnType<typeof useRunSession>;

const RunSessionContext = createContext<RunSessionValue | null>(null);

/** App-wide run WebSocket + event stream — survives route changes. */
export function RunSessionProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const runIdParam = searchParams.get("runId");
  const session = useRunSession(runIdParam, { persist: true });

  return (
    <RunSessionContext.Provider value={session}>{children}</RunSessionContext.Provider>
  );
}

export function useRunSessionContext(): RunSessionValue {
  const ctx = useContext(RunSessionContext);
  if (!ctx) {
    throw new Error("useRunSessionContext must be used within RunSessionProvider");
  }
  return ctx;
}

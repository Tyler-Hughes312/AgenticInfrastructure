"use client";

import { useEffect, useRef } from "react";
import { useRunSessionContext } from "../run/RunSessionProvider";
import { useOrchestrator } from "./OrchestratorProvider";

/** Persist orchestrator_graph_updated events from any page (not only workspace). */
export default function OrchestratorGraphSync() {
  const { events } = useRunSessionContext();
  const { applyRemoteConfig, saveConfig } = useOrchestrator();
  const lastGraphEventTs = useRef(0);

  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.event !== "orchestrator_graph_updated") continue;
      const ts = e.ts ?? 0;
      if (ts && ts <= lastGraphEventTs.current) break;
      lastGraphEventTs.current = ts || Date.now();
      const next = (e.data as { config?: Parameters<typeof applyRemoteConfig>[0] } | undefined)
        ?.config;
      if (next && Array.isArray(next.agents)) {
        applyRemoteConfig(next);
        void saveConfig(next);
      }
      break;
    }
  }, [events, applyRemoteConfig, saveConfig]);

  return null;
}

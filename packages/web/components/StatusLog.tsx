"use client";

import { useMemo } from "react";
import { deriveStatusText } from "../lib/run-status";
import type { RunEvent } from "../lib/types/run";

export default function StatusLog({ events }: { events: RunEvent[] }) {
  const currentStatus = useMemo(() => {
    if (!events.length) return null;
    return deriveStatusText(events);
  }, [events]);

  if (!currentStatus) return null;

  return (
    <div className="mb-2">
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-charcoal-raised border border-charcoal-border">
        <span className="w-1.5 h-1.5 rounded-full bg-charcoal-accent animate-pulse shrink-0" />
        <span className="text-xs text-charcoal-muted">{currentStatus}</span>
      </div>
    </div>
  );
}

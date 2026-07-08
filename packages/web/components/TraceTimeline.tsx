"use client";

export default function TraceTimeline({ events }: { events: any[] }) {
  return (
    <div>
      {events.length === 0 ? (
        <p className="text-xs text-charcoal-muted">No events yet...</p>
      ) : (
        <ul className="text-xs space-y-1 max-h-[320px] overflow-auto">
          {events.slice(-80).map((e, i) => (
            <li
              key={i}
              className="grid grid-cols-[1fr_auto_auto] gap-2 items-start py-1.5 border-b border-charcoal-border"
            >
              <span className="font-mono text-charcoal-text truncate">
                {e.name || e.event}
                {e.metadata?.langgraph_node ? (
                  <span className="text-charcoal-muted ml-1">@{e.metadata.langgraph_node}</span>
                ) : null}
              </span>
              <span className="text-charcoal-muted">{e.event}</span>
              <span className="text-charcoal-muted/70">{e.ts ? new Date(e.ts).toLocaleTimeString() : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

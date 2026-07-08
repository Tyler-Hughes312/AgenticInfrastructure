"use client";

export default function StateInspector({ state }: { state: any }) {
  return (
    <pre className="text-xs overflow-auto bg-charcoal-bg p-2 rounded border border-charcoal-border text-charcoal-muted">
      {JSON.stringify(state, null, 2)}
    </pre>
  );
}

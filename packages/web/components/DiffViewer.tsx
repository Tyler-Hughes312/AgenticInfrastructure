"use client";

import { DiffItem } from "./diff";

export default function DiffViewer({ diffs }: { diffs: DiffItem[] }) {
  return (
    <div>
      {!diffs.length ? (
        <p className="text-sm text-charcoal-muted">No diffs yet.</p>
      ) : (
        <ul className="space-y-3 max-h-[260px] overflow-auto text-sm">
          {diffs.map((d, i) => (
            <li key={i} className="border border-charcoal-border rounded-xl p-2">
              <div className="font-mono text-xs mb-1 text-charcoal-text">{d.path}</div>
              <div className="grid grid-cols-2 gap-2">
                <pre className="text-xs bg-charcoal-bg p-2 rounded-lg overflow-auto text-charcoal-muted border border-charcoal-border">
                  {JSON.stringify(d.before, null, 2)}
                </pre>
                <pre className="text-xs bg-charcoal-bg p-2 rounded-lg overflow-auto text-charcoal-muted border border-charcoal-border">
                  {JSON.stringify(d.after, null, 2)}
                </pre>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

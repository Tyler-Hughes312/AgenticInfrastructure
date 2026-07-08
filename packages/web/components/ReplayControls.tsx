"use client";

import { useRouter } from "next/navigation";

export default function ReplayControls({
  max,
  value,
  onChange,
  isLive,
  onToggleLive,
}: {
  max: number;
  value: number;
  onChange: (v: number) => void;
  isLive: boolean;
  onToggleLive: () => void;
}) {
  const router = useRouter();

  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={Math.max(0, max)}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-charcoal-accent"
          disabled={isLive}
        />
        <span className="text-sm w-10 text-right text-charcoal-text">{value}</span>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          className="px-3 py-1 rounded-lg border border-charcoal-border text-sm flex-1 text-charcoal-text hover:bg-charcoal-raised"
          onClick={onToggleLive}
        >
          {isLive ? "Pause live" : "Resume live"}
        </button>
        <button
          className="px-3 py-1 rounded-lg border border-charcoal-border text-sm bg-charcoal-raised text-charcoal-text hover:bg-charcoal-border/40"
          onClick={() => router.push("/")}
          title="Start a new run"
        >
          New Run
        </button>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import ActivityBar from "./ActivityBar";

export default function SecondaryPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-charcoal-bg text-charcoal-text">
      <ActivityBar />
      <div className="flex-1 min-w-0 h-full overflow-y-auto">{children}</div>
    </div>
  );
}

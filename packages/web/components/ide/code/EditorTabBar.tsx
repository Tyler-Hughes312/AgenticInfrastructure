"use client";

export type EditorTab =
  | { id: string; kind: "file"; path: string; dirty?: boolean }
  | { id: string; kind: "diff"; path: string; changeId: string; label: string };

type EditorTabBarProps = {
  tabs: EditorTab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
};

export default function EditorTabBar({ tabs, activeTabId, onSelect, onClose }: EditorTabBarProps) {
  if (!tabs.length) {
    return (
      <div className="h-9 border-b border-charcoal-border bg-charcoal-surface px-3 flex items-center text-xs text-charcoal-muted">
        Open a file from the explorer or agent changes
      </div>
    );
  }

  return (
    <div className="h-9 border-b border-charcoal-border bg-charcoal-surface flex items-stretch overflow-x-auto shrink-0">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const label =
          tab.kind === "file"
            ? `${tab.dirty ? "• " : ""}${tab.path.split("/").pop()}`
            : tab.label;
        return (
          <div
            key={tab.id}
            className={`group flex items-center gap-1 px-3 border-r border-charcoal-border text-xs font-mono cursor-pointer shrink-0 ${
              active
                ? "bg-charcoal-bg text-charcoal-text"
                : "bg-charcoal-surface text-charcoal-muted hover:text-charcoal-text"
            }`}
            onClick={() => onSelect(tab.id)}
          >
            <span className="truncate max-w-[160px]" title={tab.kind === "file" ? tab.path : tab.path}>
              {label}
            </span>
            <button
              type="button"
              className="opacity-60 hover:opacity-100 text-charcoal-muted hover:text-charcoal-text px-1"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              aria-label="Close tab"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function tabIdForFile(path: string): string {
  return `file:${path}`;
}

export function tabIdForDiff(changeId: string): string {
  return `diff:${changeId}`;
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useChatSession } from "../../chat/ChatSessionProvider";
import {
  createWorkspaceFile,
  fetchWorkspaceChangeDetail,
  fetchWorkspaceChanges,
  fetchWorkspaceFile,
  fetchWorkspaceTree,
  saveWorkspaceFile,
  workspaceFileDownloadUrl,
  workspaceZipExportUrl,
  type WorkspaceFileChangeSummary,
  type WorkspaceTreeNode,
} from "../../../app/api-client";
import FileExplorer from "./FileExplorer";
import EditorTabBar, {
  tabIdForDiff,
  tabIdForFile,
  type EditorTab,
} from "./EditorTabBar";
import CodeEditorPane from "./CodeEditorPane";
import DiffEditorPane from "./DiffEditorPane";
import AgentChangesPanel from "./AgentChangesPanel";

type FileBuffer = {
  content: string;
  savedContent: string;
  encoding: "utf-8" | "base64";
  mime?: string;
  size?: number;
  editable: boolean;
};

type DiffBuffer = {
  before: string;
  after: string;
  path: string;
};

const FILE_TEMPLATES = [
  { id: "md", label: "Markdown", path: "docs/notes.md", content: "# Title\n\n" },
  { id: "txt", label: "Plain text", path: "output/notes.txt", content: "" },
  { id: "html", label: "HTML", path: "output/page.html", content: "<!DOCTYPE html>\n<html>\n<head><title>Page</title></head>\n<body>\n</body>\n</html>\n" },
  { id: "json", label: "JSON", path: "output/data.json", content: "{\n  \n}\n" },
  { id: "csv", label: "CSV", path: "output/data.csv", content: "column1,column2\n" },
  { id: "ts", label: "TypeScript", path: "src/index.ts", content: "export function main() {\n  // TODO\n}\n" },
  { id: "py", label: "Python", path: "src/main.py", content: "def main():\n    pass\n\nif __name__ == \"__main__\":\n    main()\n" },
] as const;

type CodeIdeShellProps = {
  runStatus?: string;
  runId?: string | null;
};

export default function CodeIdeShell({ runStatus, runId }: CodeIdeShellProps) {
  const { sessionId } = useChatSession();
  const searchParams = useSearchParams();
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([]);
  const [changes, setChanges] = useState<WorkspaceFileChangeSummary[]>([]);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [fileBuffers, setFileBuffers] = useState<Record<string, FileBuffer>>({});
  const [diffBuffers, setDiffBuffers] = useState<Record<string, DiffBuffer>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"files" | "changes">("files");
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState<string>(FILE_TEMPLATES[0].path);
  const [newFileContent, setNewFileContent] = useState<string>(FILE_TEMPLATES[0].content);
  const [prevRunStatus, setPrevRunStatus] = useState(runStatus);

  const refreshWorkspace = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const [treeResult, changesResult] = await Promise.allSettled([
        fetchWorkspaceTree(sessionId),
        fetchWorkspaceChanges(sessionId),
      ]);
      if (treeResult.status === "fulfilled") setTree(treeResult.value);
      else setError(treeResult.reason instanceof Error ? treeResult.reason.message : String(treeResult.reason));
      if (changesResult.status === "fulfilled") setChanges(changesResult.value);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  useEffect(() => {
    if (
      prevRunStatus === "running" &&
      (runStatus === "completed" || runStatus === "error" || runStatus === "failed")
    ) {
      void refreshWorkspace();
    }
    setPrevRunStatus(runStatus);
  }, [runStatus, prevRunStatus, refreshWorkspace]);

  useEffect(() => {
    if (runId) void refreshWorkspace();
  }, [runId, refreshWorkspace]);

  const openFile = useCallback(
    async (path: string) => {
      if (!sessionId) return;
      const id = tabIdForFile(path);
      setTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        return [...prev, { id, kind: "file", path }];
      });
      setActiveTabId(id);
      setSidebarTab("files");

      if (fileBuffers[path]) return;

      try {
        const file = await fetchWorkspaceFile(sessionId, path);
        const editable = file.encoding === "utf-8";
        setFileBuffers((prev) => ({
          ...prev,
          [path]: {
            content: file.content,
            savedContent: file.content,
            encoding: file.encoding,
            mime: file.mime,
            size: file.size,
            editable,
          },
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [sessionId, fileBuffers]
  );

  const openDiff = useCallback(
    async (change: WorkspaceFileChangeSummary) => {
      if (!sessionId) return;
      const id = tabIdForDiff(change.id);
      const label = `Δ ${change.path.split("/").pop()}`;
      setTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        return [...prev, { id, kind: "diff", path: change.path, changeId: change.id, label }];
      });
      setActiveTabId(id);
      setSidebarTab("changes");

      if (diffBuffers[change.id]) return;

      try {
        const detail = await fetchWorkspaceChangeDetail(sessionId, change.id);
        setDiffBuffers((prev) => ({
          ...prev,
          [change.id]: {
            before: detail.before,
            after: detail.after,
            path: detail.path,
          },
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [sessionId, diffBuffers]
  );

  useEffect(() => {
    const pathParam = searchParams.get("path");
    const changeParam = searchParams.get("change");
    if (!sessionId || loading) return;
    if (pathParam) void openFile(pathParam);
    if (changeParam) {
      const change = changes.find((c) => c.id === changeParam);
      if (change) void openDiff(change);
    }
  }, [searchParams, sessionId, loading, changes, openFile, openDiff]);

  const displayTabs = useMemo(
    () =>
      tabs.map((t) =>
        t.kind === "file" && fileBuffers[t.path]
          ? {
              ...t,
              dirty:
                fileBuffers[t.path].editable &&
                fileBuffers[t.path].content !== fileBuffers[t.path].savedContent,
            }
          : t
      ),
    [tabs, fileBuffers]
  );

  const activeTab = useMemo(
    () => displayTabs.find((t) => t.id === activeTabId) ?? null,
    [displayTabs, activeTabId]
  );

  const updateFileContent = useCallback((path: string, content: string) => {
    setFileBuffers((prev) => {
      const existing = prev[path];
      if (!existing || !existing.editable) return prev;
      return {
        ...prev,
        [path]: { ...existing, content },
      };
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!sessionId || !activeTab || activeTab.kind !== "file") return;
    const buffer = fileBuffers[activeTab.path];
    if (!buffer?.editable) return;
    setSaving(true);
    setError(null);
    try {
      await saveWorkspaceFile(sessionId, activeTab.path, buffer.content);
      setFileBuffers((prev) => ({
        ...prev,
        [activeTab.path]: { ...buffer, savedContent: buffer.content },
      }));
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, dirty: false } : t))
      );
      void refreshWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [sessionId, activeTab, fileBuffers, refreshWorkspace]);

  const handleCreateFile = useCallback(async () => {
    if (!sessionId) return;
    const path = newFilePath.trim();
    if (!path) return;
    setSaving(true);
    setError(null);
    try {
      await createWorkspaceFile(sessionId, path, newFileContent);
      setShowNewFile(false);
      await refreshWorkspace();
      await openFile(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [sessionId, newFilePath, newFileContent, refreshWorkspace, openFile]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          setActiveTabId(next[next.length - 1]?.id ?? null);
        }
        return next;
      });
    },
    [activeTabId]
  );

  const activeFilePath = activeTab?.kind === "file" ? activeTab.path : undefined;
  const activeBuffer = activeFilePath ? fileBuffers[activeFilePath] : undefined;

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center text-charcoal-muted text-sm">
        No session loaded.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-charcoal-bg text-charcoal-text">
      <div className="h-10 shrink-0 border-b border-charcoal-border bg-charcoal-surface flex items-center justify-between px-3">
        <div className="text-sm font-medium">Code IDE</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewFile(true)}
            className="text-xs px-2.5 py-1 rounded border border-charcoal-border hover:bg-charcoal-raised"
          >
            New file
          </button>
          <a
            href={workspaceZipExportUrl(sessionId)}
            className="text-xs px-2.5 py-1 rounded border border-charcoal-border hover:bg-charcoal-raised"
          >
            Export ZIP
          </a>
          <button
            type="button"
            onClick={() => void refreshWorkspace()}
            className="text-xs px-2.5 py-1 rounded border border-charcoal-border hover:bg-charcoal-raised"
          >
            Refresh
          </button>
          {activeTab?.kind === "file" && activeBuffer?.editable && (
            <>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="text-xs px-2.5 py-1 rounded bg-charcoal-accent text-white hover:brightness-110 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
          {activeTab?.kind === "file" && (
            <a
              href={workspaceFileDownloadUrl(sessionId, activeTab.path)}
              className="text-xs px-2.5 py-1 rounded border border-charcoal-border hover:bg-charcoal-raised"
            >
              Download
            </a>
          )}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-red-400 bg-red-950/30 border-b border-charcoal-border">
          {error}
        </div>
      )}

      {showNewFile && (
        <div className="px-3 py-3 border-b border-charcoal-border bg-charcoal-surface space-y-2">
          <div className="flex flex-wrap gap-2">
            {FILE_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  setNewFilePath(tpl.path);
                  setNewFileContent(tpl.content);
                }}
                className="text-xs px-2 py-1 rounded border border-charcoal-border hover:bg-charcoal-raised"
              >
                {tpl.label}
              </button>
            ))}
          </div>
          <input
            value={newFilePath}
            onChange={(e) => setNewFilePath(e.target.value)}
            placeholder="docs/report.md"
            className="w-full text-xs font-mono bg-charcoal-bg border border-charcoal-border rounded px-2 py-1.5"
          />
          <textarea
            value={newFileContent}
            onChange={(e) => setNewFileContent(e.target.value)}
            rows={4}
            className="w-full text-xs font-mono bg-charcoal-bg border border-charcoal-border rounded px-2 py-1.5"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleCreateFile()}
              disabled={saving || !newFilePath.trim()}
              className="text-xs px-3 py-1.5 rounded bg-charcoal-accent text-white disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNewFile(false)}
              className="text-xs px-3 py-1.5 rounded border border-charcoal-border"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <aside className="w-64 shrink-0 border-r border-charcoal-border bg-charcoal-surface flex flex-col min-h-0">
          <div className="flex border-b border-charcoal-border shrink-0">
            <button
              type="button"
              onClick={() => setSidebarTab("files")}
              className={`flex-1 text-xs py-2 ${
                sidebarTab === "files"
                  ? "text-charcoal-text bg-charcoal-bg"
                  : "text-charcoal-muted hover:text-charcoal-text"
              }`}
            >
              Files
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab("changes")}
              className={`flex-1 text-xs py-2 ${
                sidebarTab === "changes"
                  ? "text-charcoal-text bg-charcoal-bg"
                  : "text-charcoal-muted hover:text-charcoal-text"
              }`}
            >
              Changes ({changes.length})
            </button>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {loading ? (
              <p className="text-xs text-charcoal-muted p-3">Loading…</p>
            ) : sidebarTab === "files" ? (
              <FileExplorer
                tree={tree}
                selectedPath={activeFilePath}
                onOpenFile={(path) => void openFile(path)}
              />
            ) : (
              <AgentChangesPanel
                changes={changes}
                onOpenDiff={(c) => void openDiff(c)}
                onOpenFile={(path) => void openFile(path)}
              />
            )}
          </div>
        </aside>

        <section className="flex-1 min-w-0 flex flex-col min-h-0">
          <EditorTabBar
            tabs={displayTabs}
            activeTabId={activeTabId}
            onSelect={setActiveTabId}
            onClose={closeTab}
          />
          <div className="flex-1 min-h-0 bg-charcoal-bg">
            {!activeTab && (
              <div className="h-full flex items-center justify-center text-sm text-charcoal-muted">
                Select a file or agent change to open — or create a new file
              </div>
            )}
            {activeTab?.kind === "file" && activeBuffer?.editable && (
              <CodeEditorPane
                path={activeTab.path}
                content={activeBuffer.content}
                onChange={(v) => updateFileContent(activeTab.path, v)}
              />
            )}
            {activeTab?.kind === "file" && activeBuffer && !activeBuffer.editable && (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-charcoal-muted p-6 text-center">
                <p>
                  Binary file ({activeBuffer.mime ?? "unknown"},{" "}
                  {activeBuffer.size ?? 0} bytes). Open in an external app or download.
                </p>
                <a
                  href={workspaceFileDownloadUrl(sessionId, activeTab.path)}
                  className="text-xs px-3 py-1.5 rounded bg-charcoal-accent text-white"
                >
                  Download file
                </a>
              </div>
            )}
            {activeTab?.kind === "file" && !activeBuffer && (
              <div className="h-full flex items-center justify-center text-sm text-charcoal-muted">
                Loading file…
              </div>
            )}
            {activeTab?.kind === "diff" && diffBuffers[activeTab.changeId] && (
              <DiffEditorPane
                path={diffBuffers[activeTab.changeId].path}
                before={diffBuffers[activeTab.changeId].before}
                after={diffBuffers[activeTab.changeId].after}
              />
            )}
            {activeTab?.kind === "diff" && !diffBuffers[activeTab.changeId] && (
              <div className="h-full flex items-center justify-center text-sm text-charcoal-muted">
                Loading diff…
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

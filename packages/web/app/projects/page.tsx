"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createProject,
  deleteProject,
  fetchProjects,
  openProject,
  type ProjectSummary,
} from "../api-client";
import SecondaryPageShell from "../../components/ide/SecondaryPageShell";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function repoLabel(project: ProjectSummary) {
  if (project.source_type === "local") return "Local workspace";
  return project.repo_url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");

  const load = useCallback(async () => {
    try {
      setProjects(await fetchProjects());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const created = await createProject({
        name: name.trim() || undefined,
        repo_url: repoUrl.trim() || "local",
        default_branch: branch.trim() || "main",
      });
      setShowCreate(false);
      setRepoUrl("");
      setName("");
      setBranch("main");
      await load();
      const opened = await openProject(created.id);
      router.push(
        `/?project=${encodeURIComponent(opened.project_id)}&session=${encodeURIComponent(opened.session_id)}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setBusy(null);
    }
  }

  async function handleOpen(projectId: string) {
    setBusy(`open-${projectId}`);
    setError(null);
    try {
      const opened = await openProject(projectId);
      router.push(
        `/?project=${encodeURIComponent(opened.project_id)}&session=${encodeURIComponent(opened.session_id)}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open project");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(projectId: string, projectName: string) {
    if (!confirm(`Delete project "${projectName}"? This removes the local workspace clone.`)) return;
    setBusy(`del-${projectId}`);
    try {
      await deleteProject(projectId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete project");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SecondaryPageShell>
      <main className="p-6 md:p-10">
        <div className="max-w-4xl mx-auto w-full space-y-8">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-charcoal-text tracking-tight">Projects</h1>
              <p className="text-sm text-charcoal-muted mt-1 max-w-xl">
                A project is a repo-backed workspace (GitHub or local). Agents edit files in the
                project workspace. Graphs are separate saved agent blueprints you apply on a
                project.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center px-3.5 py-2 text-sm font-medium rounded-lg bg-charcoal-accent text-white hover:brightness-110"
            >
              New project
            </button>
          </header>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {showCreate && (
            <form
              onSubmit={(e) => void handleCreate(e)}
              className="rounded-xl border border-charcoal-border bg-charcoal-surface p-4 space-y-3"
            >
              <h2 className="text-sm font-semibold text-charcoal-text">Create project</h2>
              <p className="text-xs text-charcoal-muted">
                Paste a GitHub URL (e.g.{" "}
                <code className="text-charcoal-text">Tyler-Hughes312/AgenticInfrastructure</code>
                ) or leave blank for a local-only workspace.
              </p>
              <input
                className="w-full bg-charcoal-bg border border-charcoal-border rounded-lg px-3 py-2 text-sm text-charcoal-text"
                placeholder="GitHub URL or owner/repo (optional)"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  className="bg-charcoal-bg border border-charcoal-border rounded-lg px-3 py-2 text-sm text-charcoal-text"
                  placeholder="Display name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <input
                  className="bg-charcoal-bg border border-charcoal-border rounded-lg px-3 py-2 text-sm text-charcoal-text"
                  placeholder="Default branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-charcoal-border text-charcoal-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy === "create"}
                  className="text-xs px-3 py-1.5 rounded-lg bg-charcoal-accent text-white disabled:opacity-50"
                >
                  {busy === "create" ? "Creating…" : "Create & open"}
                </button>
              </div>
            </form>
          )}

          <div className="bg-charcoal-surface rounded-xl border border-charcoal-border overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-charcoal-raised/80 text-charcoal-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Repo</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-charcoal-border hover:bg-charcoal-raised/40 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-charcoal-text">{p.name}</td>
                    <td className="px-4 py-2.5 text-charcoal-muted">
                      <span className="capitalize">{p.source_type}</span>
                      <span className="mx-1">·</span>
                      {repoLabel(p)}
                    </td>
                    <td className="px-4 py-2.5 text-charcoal-muted whitespace-nowrap">
                      {formatDate(p.created_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void handleOpen(p.id)}
                          disabled={busy === `open-${p.id}`}
                          className="text-xs font-medium text-charcoal-accent hover:underline disabled:opacity-50"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(p.id, p.name)}
                          disabled={busy === `del-${p.id}`}
                          className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!projects.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-charcoal-muted">
                      No projects yet. Create one from a GitHub repo or start with a local workspace.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-charcoal-muted">
            Saved agent graphs live on the{" "}
            <Link href="/runs" className="text-charcoal-accent hover:underline">
              Runs
            </Link>{" "}
            page under Graphs (blueprints).
          </p>
        </div>
      </main>
    </SecondaryPageShell>
  );
}

import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { HumanMessage } from "@langchain/core/messages";
import { env } from "../config.js";
import { getCompiledGraph } from "../agents/graph.js";
import type { OrchestratorGraphConfig } from "../agents/agent-registry.js";
import { clearCompiledGraphCache, getGraphSchemaFromConfig } from "../agents/dynamic-graph.js";
import { getAppDb } from "../db/app-db.js";
import { runs, events, projects } from "../db/schema.js";
import { isRemoteRepo, prepareWorkspace } from "../tools/git-ops.js";
import { setRunContext, clearRunContext } from "../tools/context.js";
import { getLangfuseHandler, buildTraceUrl } from "../observability/langfuse.js";
import { runWithCredentials } from "../credentials/store.js";
import type { RunCredentials } from "../credentials/types.js";

type StreamListener = (event: Record<string, unknown>) => void;

const listeners = new Map<string, Set<StreamListener>>();
const activeRuns = new Map<string, AbortController>();
const sessionWorkspaces = new Set<string>();

export function releaseSessionWorkspace(runId: string): void {
  const workspaceDir = join(env.WORKSPACE_ROOT, runId);
  clearRunContext(runId);
  activeRuns.delete(runId);
  if (sessionWorkspaces.has(runId)) {
    sessionWorkspaces.delete(runId);
    if (existsSync(workspaceDir)) rmSync(workspaceDir, { recursive: true, force: true });
  }
}

export function subscribeRun(runId: string, listener: StreamListener): () => void {
  if (!listeners.has(runId)) listeners.set(runId, new Set());
  listeners.get(runId)!.add(listener);
  return () => listeners.get(runId)?.delete(listener);
}

function emit(runId: string, event: Record<string, unknown>) {
  listeners.get(runId)?.forEach((fn) => fn(event));
}

async function persistEvent(runId: string, type: string, payload: Record<string, unknown>) {
  const db = getAppDb();
  await db.insert(events).values({
    runId,
    type,
    payload: JSON.stringify(payload),
  });
}

function mapStreamEvent(ev: { event: string; name?: string }) {
  const name = ev.name ?? "";
  if (ev.event === "on_chain_start") return { type: "node_enter", node: name };
  if (ev.event === "on_chain_end") return { type: "node_exit", node: name };
  if (ev.event === "on_tool_start") return { type: "tool_start", tool: name };
  if (ev.event === "on_tool_end") return { type: "tool_end", tool: name };
  return null;
}

function toAgentLensEvent(
  runId: string,
  ev: Record<string, unknown>,
  stepIndex: number
): Record<string, unknown> {
  return {
    run_id: runId,
    event: ev.event,
    name: ev.name,
    data: ev.data,
    metadata: ev.metadata,
    ts: Date.now(),
    step_index: stepIndex,
  };
}

async function executeRun(
  params: {
    runId: string;
    projectId: string;
    task: string;
    repoUrl: string;
    githubToken: string;
    branch?: string;
    credentials?: RunCredentials;
    keepWorkspace?: boolean;
    orchestratorConfig?: OrchestratorGraphConfig;
    targetAgent?: string;
  },
  onAgentLensEvent?: (event: Record<string, unknown>) => void | Promise<void>
): Promise<void> {
  const { runId, projectId, task, repoUrl, githubToken, credentials = {} } = params;
  const keepWorkspace = params.keepWorkspace ?? false;
  const targetAgent = params.targetAgent;
  const orchestratorConfig = params.orchestratorConfig;
  const branch = params.branch ?? `agent/run-${runId.slice(0, 8)}`;
  const workspaceDir = join(env.WORKSPACE_ROOT, runId);
  const db = getAppDb();

  await runWithCredentials(credentials, async () => {

  if (!existsSync(env.WORKSPACE_ROOT)) mkdirSync(env.WORKSPACE_ROOT, { recursive: true });
  if (!keepWorkspace && existsSync(workspaceDir)) {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
  if (keepWorkspace) sessionWorkspaces.add(runId);

  await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));

  setRunContext(runId, {
    workspaceDir,
    runId,
    projectId,
    repoUrl,
    githubToken,
    branch,
  });

  const controller = new AbortController();
  activeRuns.set(runId, controller);

  try {
    prepareWorkspace(repoUrl, workspaceDir);
    // Rebuild graph with this run's credentials (do not reuse a model compiled without keys).
    clearCompiledGraphCache();
    const graph = getCompiledGraph(orchestratorConfig, targetAgent);
    const handler = getLangfuseHandler(runId, projectId);
    const launchHint = targetAgent ? `[Orchestrator launch @${targetAgent}] ` : "";
    const input = { messages: [new HumanMessage(launchHint + task)] };
    const config = {
      configurable: {
        thread_id: runId,
        run_id: runId,
        project_id: projectId,
        workspace_dir: workspaceDir,
        repo_url: repoUrl,
        github_token: githubToken,
        branch,
      },
      callbacks: handler ? [handler] : [],
      signal: controller.signal,
    };

    let githubPrUrl: string | undefined;
    let stepIndex = 0;
    const traceId = (handler as { last_trace_id?: string } | null)?.last_trace_id;

    for await (const ev of graph.streamEvents(input, { ...config, version: "v2" })) {
      const raw = ev as Record<string, unknown>;
      const agentLensEv = toAgentLensEvent(runId, raw, stepIndex);
      await onAgentLensEvent?.(agentLensEv);

      const mapped = mapStreamEvent(raw as { event: string; name?: string });
      if (mapped) {
        emit(runId, mapped);
        await persistEvent(runId, mapped.type, mapped);
      }
      if (raw.event === "on_chain_end") stepIndex += 1;

      if (raw.event === "on_tool_end" && raw.name === "open_pull_request") {
        const output = (raw.data as { output?: string } | undefined)?.output;
        if (typeof output === "string" && output.startsWith("http")) {
          githubPrUrl = output;
        }
      }
    }

    const langfuseTraceUrl = traceId ? buildTraceUrl(traceId) : undefined;
    await db
      .update(runs)
      .set({
        status: "completed",
        githubPrUrl: githubPrUrl ?? null,
        langfuseTraceUrl: langfuseTraceUrl ?? null,
        completedAt: new Date(),
      })
      .where(eq(runs.id, runId));

    emit(runId, { type: "run_completed", status: "completed", githubPrUrl, langfuseTraceUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(runs)
      .set({ status: "failed", error: message, completedAt: new Date() })
      .where(eq(runs.id, runId));
    emit(runId, { type: "run_failed", error: message });
    throw err;
  } finally {
    clearRunContext(runId);
    activeRuns.delete(runId);
    if (!keepWorkspace && existsSync(workspaceDir)) {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }
  });
}

export async function startRun(params: {
  runId: string;
  projectId: string;
  task: string;
  repoUrl: string;
  githubToken: string;
  branch?: string;
  credentials?: RunCredentials;
}): Promise<void> {
  await executeRun(params);
}

export async function startRunFromQuestion(params: {
  runId: string;
  projectId: string;
  task: string;
  repoUrl: string;
  githubToken: string;
  branch?: string;
  credentials?: RunCredentials;
}): Promise<void> {
  await executeRun(params);
}

export async function* streamRunAgentLensEvents(params: {
  runId: string;
  projectId: string;
  task: string;
  repoUrl: string;
  githubToken: string;
  branch?: string;
  credentials?: RunCredentials;
  keepWorkspace?: boolean;
  orchestratorConfig?: OrchestratorGraphConfig;
  targetAgent?: string;
}): AsyncGenerator<Record<string, unknown>> {
  const queue: Record<string, unknown>[] = [];
  let resolveNext: (() => void) | null = null;
  let done = false;
  let runError: Error | null = null;

  const push = (event: Record<string, unknown>) => {
    queue.push(event);
    resolveNext?.();
    resolveNext = null;
  };

  const runPromise = executeRun(params, async (event) => {
    push(event);
  })
    .then(() => {
      done = true;
      resolveNext?.();
    })
    .catch((err) => {
      runError = err instanceof Error ? err : new Error(String(err));
      done = true;
      resolveNext?.();
    });

  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((r) => {
        resolveNext = r;
      });
      continue;
    }
    const event = queue.shift()!;
    yield event;
  }

  await runPromise;
  if (runError) throw runError;
}

export async function delegateToRun(
  runId: string,
  task: string,
  targetWorker?: string
): Promise<void> {
  for await (const _ of streamFollowUpToRun(runId, task, targetWorker)) {
    // consume stream
  }
}

export async function* streamFollowUpToRun(
  runId: string,
  task: string,
  targetWorker?: string,
  credentials: RunCredentials = {},
  orchestratorConfig?: OrchestratorGraphConfig
): AsyncGenerator<Record<string, unknown>> {
  const db = getAppDb();
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error("Run not found");
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, run.projectId))
    .limit(1);
  if (!project) throw new Error("Project not found");

  const githubToken = credentials.githubToken ?? env.GITHUB_TOKEN ?? "";
  if (isRemoteRepo(project.repoUrl) && !githubToken) {
    throw new Error("GitHub token required");
  }

  const branch = run.branch ?? `agent/run-${runId.slice(0, 8)}`;
  const workspaceDir = join(env.WORKSPACE_ROOT, runId);
  const queue: Record<string, unknown>[] = [];
  let resolveNext: (() => void) | null = null;
  let done = false;
  let runError: Error | null = null;

  const push = (event: Record<string, unknown>) => {
    queue.push(event);
    resolveNext?.();
    resolveNext = null;
  };

  const runPromise = runWithCredentials(credentials, async () => {
    if (!existsSync(env.WORKSPACE_ROOT)) mkdirSync(env.WORKSPACE_ROOT, { recursive: true });
    sessionWorkspaces.add(runId);

    prepareWorkspace(project.repoUrl, workspaceDir);

    setRunContext(runId, {
      workspaceDir,
      runId,
      projectId: run.projectId,
      repoUrl: project.repoUrl,
      githubToken,
      branch,
    });

    await db.update(runs).set({ status: "running", error: null }).where(eq(runs.id, runId));

    const controller = new AbortController();
    activeRuns.set(runId, controller);

    try {
      clearCompiledGraphCache();
      const graph = getCompiledGraph(orchestratorConfig, targetWorker);
      const handler = getLangfuseHandler(runId, run.projectId);
      const launchHint = targetWorker ? `[Orchestrator launch @${targetWorker}] ` : "";
      const input = { messages: [new HumanMessage(launchHint + task)] };
      const config = {
        configurable: {
          thread_id: runId,
          run_id: runId,
          project_id: run.projectId,
          workspace_dir: workspaceDir,
          repo_url: project.repoUrl,
          github_token: githubToken,
          branch,
        },
        callbacks: handler ? [handler] : [],
        signal: controller.signal,
      };

      let githubPrUrl: string | undefined;
      let stepIndex = 0;
      const traceId = (handler as { last_trace_id?: string } | null)?.last_trace_id;

      for await (const ev of graph.streamEvents(input, { ...config, version: "v2" })) {
        const raw = ev as Record<string, unknown>;
        const agentLensEv = toAgentLensEvent(runId, raw, stepIndex);
        push(agentLensEv);

        const mapped = mapStreamEvent(raw as { event: string; name?: string });
        if (mapped) {
          emit(runId, mapped);
          await persistEvent(runId, mapped.type, mapped);
        }
        if (raw.event === "on_chain_end") stepIndex += 1;

        if (raw.event === "on_tool_end" && raw.name === "open_pull_request") {
          const output = (raw.data as { output?: string } | undefined)?.output;
          if (typeof output === "string" && output.startsWith("http")) {
            githubPrUrl = output;
          }
        }
      }

      const langfuseTraceUrl = traceId ? buildTraceUrl(traceId) : undefined;
      await db
        .update(runs)
        .set({
          status: "completed",
          githubPrUrl: githubPrUrl ?? run.githubPrUrl,
          langfuseTraceUrl: langfuseTraceUrl ?? run.langfuseTraceUrl,
          completedAt: new Date(),
        })
        .where(eq(runs.id, runId));

      emit(runId, { type: "run_completed", status: "completed", githubPrUrl, langfuseTraceUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(runs)
        .set({ status: "failed", error: message, completedAt: new Date() })
        .where(eq(runs.id, runId));
      emit(runId, { type: "run_failed", error: message });
      throw err;
    } finally {
      clearRunContext(runId);
      activeRuns.delete(runId);
    }
  })
    .then(() => {
      done = true;
      resolveNext?.();
    })
    .catch((err) => {
      runError = err instanceof Error ? err : new Error(String(err));
      done = true;
      resolveNext?.();
    });

  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((r) => {
        resolveNext = r;
      });
      continue;
    }
    const event = queue.shift()!;
    yield event;
  }

  await runPromise;
  if (runError) throw runError;
}

export function getGraphSchemaAgentLens() {
  return getGraphSchemaFromConfig();
}

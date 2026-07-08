import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { HumanMessage } from "@langchain/core/messages";
import { env } from "../config.js";
import { getCompiledGraph } from "../agents/graph.js";
import {
  normalizeOrchestratorConfig,
  type CustomAgentConfig,
  type OrchestratorGraphConfig,
} from "../agents/agent-registry.js";
import {
  clearCompiledGraphCache,
  getGraphSchemaFromConfig,
  getSessionOrchestratorConfig,
  setSessionOrchestratorConfig,
} from "../agents/dynamic-graph.js";
import { applyGraphEdit, type GraphEditCommand } from "../agents/graph-edit.js";
import { classifyMessageIntent } from "../agents/message-classifier.js";
import {
  designGraphFromPrompt,
  synthesizeFinalChatAnswer,
  repoHintFromTask,
} from "../agents/design-graph-from-prompt.js";
import { getModel } from "../models-llm.js";
import { getAppDb } from "../db/app-db.js";
import { runs, events, projects } from "../db/schema.js";
import { isRemoteRepo, prepareWorkspace } from "../tools/git-ops.js";
import { setRunContext, clearRunContext } from "../tools/context.js";
import { getLangfuseHandler, buildTraceUrl } from "../observability/langfuse.js";
import { runWithCredentials } from "../credentials/store.js";
import type { RunCredentials } from "../credentials/types.js";

const GRAPH_RECURSION_LIMIT = 80;

function resolveSessionConfig(
  orchestratorConfig?: OrchestratorGraphConfig
): OrchestratorGraphConfig {
  const incoming = normalizeOrchestratorConfig(orchestratorConfig);
  const session = normalizeOrchestratorConfig(getSessionOrchestratorConfig());
  // Prefer an explicit non-blank incoming config; otherwise use session.
  const isBlank = (c: OrchestratorGraphConfig) => !c.agents.length;
  return !isBlank(incoming) ? incoming : session;
}

function isConfirmation(text: string): boolean {
  return /^\s*(yes|y|confirm|do\s+it|apply|ok|okay|sure|go|proceed|lgtm)\s*[.!?]?\s*$/i.test(
    text
  );
}

async function emitChatMessage(
  runId: string,
  content: string,
  stepIndex: number,
  onAgentLensEvent?: (event: Record<string, unknown>) => void | Promise<void>
): Promise<void> {
  await onAgentLensEvent?.({
    run_id: runId,
    event: "on_chat_model_end",
    name: "supervisor",
    data: { output: { content } },
    metadata: { langgraph_node: "supervisor" },
    ts: Date.now(),
    step_index: stepIndex,
  });
}

async function emitGraphUpdated(
  runId: string,
  config: OrchestratorGraphConfig,
  reason: string,
  stepIndex: number,
  onAgentLensEvent?: (event: Record<string, unknown>) => void | Promise<void>
): Promise<void> {
  const schema = getGraphSchemaFromConfig(config);
  await onAgentLensEvent?.({
    run_id: runId,
    event: "orchestrator_graph_updated",
    name: "graph_edit",
    data: {
      config,
      schema,
      reason,
      deployed: true,
      agent_ids: config.agents.map((a) => a.id),
    },
    ts: Date.now(),
    step_index: stepIndex,
  });
}

type StreamListener = (event: Record<string, unknown>) => void;

const listeners = new Map<string, Set<StreamListener>>();
const activeRuns = new Map<string, AbortController>();
/**
 * Stores pending NL graph-edit confirmations keyed by projectId.
 * Cleared on apply, cancel, or when a new task_run starts.
 */
const pendingGraphEdits = new Map<
  string,
  { description: string; command: GraphEditCommand | null }
>();
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
    clearCompiledGraphCache();

    let graphConfig = resolveSessionConfig(orchestratorConfig);

    // Pending confirmation check: user said "yes" to a pending NL edit.
    // Checked before classification to avoid wasting an LLM call on "yes" replies.
    const pending = pendingGraphEdits.get(projectId);
    if (pending && isConfirmation(task)) {
      pendingGraphEdits.delete(projectId);
      if (pending.command) {
        const edited = applyGraphEdit(graphConfig, pending.command);
        graphConfig = edited.config;
        setSessionOrchestratorConfig(graphConfig);
        clearCompiledGraphCache();
        await emitGraphUpdated(runId, graphConfig, "graph_edit_confirmed", 0, onAgentLensEvent);
        await emitChatMessage(runId, edited.message, 1, onAgentLensEvent);
      } else {
        await emitChatMessage(
          runId,
          `Cancelled — I wasn't sure what to change. Try a more specific command.`,
          0,
          onAgentLensEvent
        );
      }
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    // --- Intent classification ---
    const intent = await classifyMessageIntent(task, graphConfig.agents);

    // Graph edits (regex fast-path).
    if (intent.kind === "graph_edit") {
      if (pendingGraphEdits.has(projectId)) {
        await emitChatMessage(runId, "_(Cancelled pending graph edit.)_", 0, onAgentLensEvent);
      }
      pendingGraphEdits.delete(projectId); // clear any stale pending edit
      const cmd = intent.command;

      // rebuild requires async LLM call — handle specially.
      if (cmd.type === "rebuild") {
        const repoHint = repoHintFromTask(cmd.task, repoUrl);
        const { config: freshConfig, summary } = await designGraphFromPrompt(cmd.task, repoHint);
        setSessionOrchestratorConfig(freshConfig);
        clearCompiledGraphCache();
        graphConfig = freshConfig;
        await emitGraphUpdated(runId, graphConfig, "graph_rebuild", 0, onAgentLensEvent);
        await emitChatMessage(runId, `Graph rebuilt: ${summary}`, 1, onAgentLensEvent);
        await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
        emit(runId, { type: "run_completed", status: "completed" });
        return;
      }

      const edited = applyGraphEdit(graphConfig, cmd);
      graphConfig = edited.config;
      setSessionOrchestratorConfig(graphConfig);
      clearCompiledGraphCache();
      await emitGraphUpdated(runId, graphConfig, `graph_edit_${cmd.type}`, 0, onAgentLensEvent);
      await emitChatMessage(runId, edited.message, 1, onAgentLensEvent);
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    // NL graph edit — ask for confirmation.
    if (intent.kind === "graph_edit_pending") {
      const priorPending = pendingGraphEdits.get(projectId);
      let stepOffset = 0;
      if (priorPending) {
        await emitChatMessage(runId, "_(Cancelled pending graph edit.)_", 0, onAgentLensEvent);
        stepOffset = 1;
      }
      pendingGraphEdits.delete(projectId); // clear any stale pending edit
      pendingGraphEdits.set(projectId, { description: intent.description, command: intent.command });
      const confirmMsg = `I'd ${intent.description}. Reply **yes** to apply or anything else to cancel.`;
      await emitChatMessage(runId, confirmMsg, stepOffset, onAgentLensEvent);
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    // Q&A — answer directly, no workers.
    if (intent.kind === "q_and_a") {
      const priorPendingQa = pendingGraphEdits.get(projectId);
      let qaStepOffset = 0;
      if (priorPendingQa) {
        await emitChatMessage(runId, "_(Cancelled pending graph edit.)_", 0, onAgentLensEvent);
        qaStepOffset = 1;
      }
      pendingGraphEdits.delete(projectId); // clear any stale pending edit
      const model = getModel(false);
      const reply = await model.invoke([new HumanMessage(task)]);
      const content =
        typeof reply.content === "string"
          ? reply.content
          : Array.isArray(reply.content)
            ? reply.content
                .map((c) =>
                  typeof c === "string" ? c : (c as { text?: string }).text ?? ""
                )
                .join("")
            : String(reply.content ?? "");
      await emitChatMessage(runId, content, qaStepOffset, onAgentLensEvent);
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    // task_run — design fresh graph with LLM, then run it.
    if (pendingGraphEdits.has(projectId)) {
      await emitChatMessage(runId, "_(Cancelled pending graph edit.)_", 0, onAgentLensEvent);
    }
    pendingGraphEdits.delete(projectId); // clear any stale pending edit
    const repoHint = repoHintFromTask(task, repoUrl);
    const { config: designedConfig } = await designGraphFromPrompt(task, repoHint);
    graphConfig = designedConfig;
    setSessionOrchestratorConfig(graphConfig);
    clearCompiledGraphCache();

    // Always push the active graph to the client so the canvas stays in sync.
    {
      const schema = getGraphSchemaFromConfig(graphConfig);
      await onAgentLensEvent?.({
        run_id: runId,
        event: "orchestrator_graph_updated",
        name: "auto_deploy",
        data: {
          config: graphConfig,
          schema,
          reason: "task_run_design",
          deployed: true,
          agent_ids: graphConfig.agents.map((a) => a.id),
        },
        ts: Date.now(),
        step_index: 0,
      });
    }

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
      recursionLimit: GRAPH_RECURSION_LIMIT,
    };

    let githubPrUrl: string | undefined;
    let stepIndex = 0;
    const traceId = (handler as { last_trace_id?: string } | null)?.last_trace_id;

    const graph = getCompiledGraph(graphConfig, targetAgent);
    const pipelineNotes: string[] = [];

    for await (const ev of graph.streamEvents(input, {
      ...config,
      version: "v2",
      recursionLimit: GRAPH_RECURSION_LIMIT,
    })) {
      const raw = ev as Record<string, unknown>;
      const agentLensEv = toAgentLensEvent(runId, raw, stepIndex);
      await onAgentLensEvent?.(agentLensEv);

      // Collect terminal agent messages for post-run synthesis.
      if (
        raw.event === "on_chat_model_end" &&
        typeof (raw.metadata as Record<string, unknown>)?.langgraph_node === "string" &&
        (raw.metadata as Record<string, unknown>).langgraph_node !== "supervisor"
      ) {
        const msgContent = (raw.data as Record<string, unknown>)?.output as Record<string, unknown> | undefined;
        const text =
          typeof msgContent?.content === "string"
            ? msgContent.content
            : "";
        if (text) pipelineNotes.push(text);
      }

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

    // Post-run: synthesize final chat answer when deliverable mode includes chat.
    const dm = graphConfig.deliverableMode;
    if (dm?.type === "chat" || dm?.type === "both") {
      if (pipelineNotes.length > 0) {
        const finalAnswer = await synthesizeFinalChatAnswer(task, pipelineNotes.join("\n\n---\n\n"));
        await emitChatMessage(runId, finalAnswer, stepIndex + 1, onAgentLensEvent);
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

  // --- Pending confirmation ---
  const pending2 = pendingGraphEdits.get(run.projectId);
  if (pending2 && isConfirmation(task)) {
    pendingGraphEdits.delete(run.projectId);
    const base2 = normalizeOrchestratorConfig(
      orchestratorConfig ?? getSessionOrchestratorConfig()
    );
    if (pending2.command) {
      const edited2 = applyGraphEdit(base2, pending2.command);
      setSessionOrchestratorConfig(edited2.config);
      clearCompiledGraphCache();
      const schema2 = getGraphSchemaFromConfig(edited2.config);
      yield {
        run_id: runId,
        event: "orchestrator_graph_updated",
        name: "graph_edit",
        data: {
          config: edited2.config,
          schema: schema2,
          reason: "graph_edit_confirmed",
          deployed: true,
          agent_ids: edited2.config.agents.map((a: CustomAgentConfig) => a.id),
        },
        ts: Date.now(),
        step_index: 0,
      };
      yield {
        run_id: runId,
        event: "on_chat_model_end",
        name: "supervisor",
        data: { output: { content: edited2.message } },
        metadata: { langgraph_node: "supervisor" },
        ts: Date.now(),
        step_index: 1,
      };
    } else {
      yield {
        run_id: runId,
        event: "on_chat_model_end",
        name: "supervisor",
        data: { output: { content: "Cancelled." } },
        metadata: { langgraph_node: "supervisor" },
        ts: Date.now(),
        step_index: 0,
      };
    }
    await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
    return;
  }

  // --- Intent classification ---
  const base = normalizeOrchestratorConfig(
    orchestratorConfig ?? getSessionOrchestratorConfig()
  );
  const intent2 = await classifyMessageIntent(task, base.agents);

  if (intent2.kind === "graph_edit") {
    if (pendingGraphEdits.has(run.projectId)) {
      yield {
        run_id: runId,
        event: "on_chat_model_end",
        name: "supervisor",
        data: { output: { content: "_(Cancelled pending graph edit.)_" } },
        metadata: { langgraph_node: "supervisor" },
        ts: Date.now(),
        step_index: 0,
      };
    }
    pendingGraphEdits.delete(run.projectId); // clear any stale pending edit
    const cmd2 = intent2.command;
    if (cmd2.type === "rebuild") {
      const { config: fresh, summary } = await designGraphFromPrompt(
        cmd2.task,
        repoHintFromTask(cmd2.task, project.repoUrl)
      );
      setSessionOrchestratorConfig(fresh);
      clearCompiledGraphCache();
      const schemaf = getGraphSchemaFromConfig(fresh);
      yield {
        run_id: runId,
        event: "orchestrator_graph_updated",
        name: "graph_edit",
        data: {
          config: fresh,
          schema: schemaf,
          reason: "graph_rebuild",
          deployed: true,
          agent_ids: fresh.agents.map((a: CustomAgentConfig) => a.id),
        },
        ts: Date.now(),
        step_index: 0,
      };
      yield {
        run_id: runId,
        event: "on_chat_model_end",
        name: "supervisor",
        data: { output: { content: `Graph rebuilt: ${summary}` } },
        metadata: { langgraph_node: "supervisor" },
        ts: Date.now(),
        step_index: 1,
      };
      await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
      return;
    }

    const edited3 = applyGraphEdit(base, cmd2);
    setSessionOrchestratorConfig(edited3.config);
    clearCompiledGraphCache();
    const schema3 = getGraphSchemaFromConfig(edited3.config);
    yield {
      run_id: runId,
      event: "orchestrator_graph_updated",
      name: "graph_edit",
      data: {
        config: edited3.config,
        schema: schema3,
        reason: `graph_edit_${cmd2.type}`,
        deployed: true,
        agent_ids: edited3.config.agents.map((a: CustomAgentConfig) => a.id),
      },
      ts: Date.now(),
      step_index: 0,
    };
    yield {
      run_id: runId,
      event: "on_chat_model_end",
      name: "supervisor",
      data: { output: { content: edited3.message } },
      metadata: { langgraph_node: "supervisor" },
      ts: Date.now(),
      step_index: 1,
    };
    await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
    return;
  }

  if (intent2.kind === "graph_edit_pending") {
    if (pendingGraphEdits.has(run.projectId)) {
      yield {
        run_id: runId,
        event: "on_chat_model_end",
        name: "supervisor",
        data: { output: { content: "_(Cancelled pending graph edit.)_" } },
        metadata: { langgraph_node: "supervisor" },
        ts: Date.now(),
        step_index: 0,
      };
    }
    pendingGraphEdits.delete(run.projectId); // clear any stale pending edit
    pendingGraphEdits.set(run.projectId, {
      description: intent2.description,
      command: intent2.command,
    });
    const confirmMsg2 = `I'd ${intent2.description}. Reply **yes** to apply or anything else to cancel.`;
    yield {
      run_id: runId,
      event: "on_chat_model_end",
      name: "supervisor",
      data: { output: { content: confirmMsg2 } },
      metadata: { langgraph_node: "supervisor" },
      ts: Date.now(),
      step_index: 0,
    };
    await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
    return;
  }

  if (intent2.kind === "q_and_a") {
    if (pendingGraphEdits.has(run.projectId)) {
      yield {
        run_id: runId,
        event: "on_chat_model_end",
        name: "supervisor",
        data: { output: { content: "_(Cancelled pending graph edit.)_" } },
        metadata: { langgraph_node: "supervisor" },
        ts: Date.now(),
        step_index: 0,
      };
    }
    pendingGraphEdits.delete(run.projectId); // clear any stale pending edit
    const qModel = getModel(false);
    const qReply = await qModel.invoke([new HumanMessage(task)]);
    const qContent =
      typeof qReply.content === "string"
        ? qReply.content
        : Array.isArray(qReply.content)
          ? qReply.content
              .map((c) => (typeof c === "string" ? c : (c as { text?: string }).text ?? ""))
              .join("")
          : String(qReply.content ?? "");
    yield {
      run_id: runId,
      event: "on_chat_model_end",
      name: "supervisor",
      data: { output: { content: qContent } },
      metadata: { langgraph_node: "supervisor" },
      ts: Date.now(),
      step_index: 0,
    };
    await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
    return;
  }

  // task_run: design fresh graph and fall through to the existing run code below.
  if (pendingGraphEdits.has(run.projectId)) {
    yield {
      run_id: runId,
      event: "on_chat_model_end",
      name: "supervisor",
      data: { output: { content: "_(Cancelled pending graph edit.)_" } },
      metadata: { langgraph_node: "supervisor" },
      ts: Date.now(),
      step_index: 0,
    };
  }
  pendingGraphEdits.delete(run.projectId);
  const { config: freshForRun } = await designGraphFromPrompt(
    task,
    repoHintFromTask(task, project.repoUrl)
  );
  setSessionOrchestratorConfig(freshForRun);
  clearCompiledGraphCache();
  orchestratorConfig = freshForRun;

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
      const pipelineNotes2: string[] = [];

      for await (const ev of graph.streamEvents(input, { ...config, version: "v2" })) {
        const raw = ev as Record<string, unknown>;
        const agentLensEv = toAgentLensEvent(runId, raw, stepIndex);
        push(agentLensEv);

        // Collect terminal agent messages for post-run synthesis.
        if (
          raw.event === "on_chat_model_end" &&
          typeof (raw.metadata as Record<string, unknown>)?.langgraph_node === "string" &&
          (raw.metadata as Record<string, unknown>).langgraph_node !== "supervisor"
        ) {
          const msgContent = (raw.data as Record<string, unknown>)?.output as Record<string, unknown> | undefined;
          const txt = typeof msgContent?.content === "string" ? msgContent.content : "";
          if (txt) pipelineNotes2.push(txt);
        }

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

      // Post-run: synthesize final chat answer when deliverable mode includes chat.
      const dm2 = orchestratorConfig?.deliverableMode;
      if ((dm2?.type === "chat" || dm2?.type === "both") && pipelineNotes2.length > 0) {
        const finalAnswer2 = await synthesizeFinalChatAnswer(task, pipelineNotes2.join("\n\n---\n\n"));
        push({
          run_id: runId,
          event: "on_chat_model_end",
          name: "supervisor",
          data: { output: { content: finalAnswer2 } },
          metadata: { langgraph_node: "supervisor" },
          ts: Date.now(),
          step_index: stepIndex + 1,
        });
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

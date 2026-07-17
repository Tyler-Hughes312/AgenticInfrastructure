import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Callbacks } from "@langchain/core/callbacks/manager";
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
import type { GraphEditCommand } from "../agents/graph-edit.js";
import { classifyMessageIntent } from "../agents/message-classifier.js";
import {
  graphContextForDirectReply,
  looksLikeProductDeliverable,
  shouldExecutePipeline,
  taskNeedsGithubToken,
} from "../agents/pipeline-gate.js";
import {
  designGraphFromPrompt,
  synthesizeFinalChatAnswer,
  repoHintFromTask,
  applyGraphChangeFromCommand,
} from "../agents/design-graph-from-prompt.js";
import { assertLlmReady, formatLlmError, isLlmAuthError, recoverCopilotAuth } from "../llm-auth.js";
import { getModel } from "../models-llm.js";
import { getAppDb } from "../db/app-db.js";
import { runs, events, projects, chatMessages } from "../db/schema.js";
import { isRemoteRepo, prepareWorkspace } from "../tools/git-ops.js";
import { setRunContext, clearRunContext } from "../tools/context.js";
import { ensureProjectWorkspace, ensureSessionWorkspace, migrateSessionWorkspaceToProject } from "./workspace-service.js";
import { getProject } from "./project-service.js";
import {
  clearPipelineHandoffs,
  formatHandoffsForPrompt,
  getPipelineHandoffs,
} from "../tools/pipeline-handoff.js";
import { getLangfuseHandler, buildTraceUrl } from "../observability/langfuse.js";
import { runWithCredentials } from "../credentials/store.js";
import type { RunCredentials } from "../credentials/types.js";
import {
  appendChatMessage,
  getChatSession,
  getChatSessionGraph,
  saveChatSessionGraph,
} from "./chat-session-service.js";

const GRAPH_RECURSION_LIMIT = 80;

function isBlankGraph(config: OrchestratorGraphConfig): boolean {
  return !normalizeOrchestratorConfig(config).agents.length;
}

function pendingEditKey(chatSessionId?: string | null, projectId?: string): string {
  return chatSessionId ?? `project:${projectId ?? "default"}`;
}

async function ensureWorkspaceForChatSession(
  chatSessionId: string,
  repoUrl: string,
  branch: string
): Promise<string> {
  const session = await getChatSession(chatSessionId);
  if (session?.projectId) {
    const project = await getProject(session.projectId);
    if (project) {
      migrateSessionWorkspaceToProject(chatSessionId, project.id);
      return ensureProjectWorkspace(project.id, project.repoUrl, project.defaultBranch);
    }
  }
  return ensureSessionWorkspace(chatSessionId, repoUrl, branch);
}

async function resolveGraphForRun(
  chatSessionId: string | undefined,
  orchestratorConfig?: OrchestratorGraphConfig
): Promise<OrchestratorGraphConfig> {
  const incoming = normalizeOrchestratorConfig(orchestratorConfig);
  if (!isBlankGraph(incoming)) return incoming;
  if (chatSessionId) {
    const sessionGraph = await getChatSessionGraph(chatSessionId);
    if (!isBlankGraph(sessionGraph)) return sessionGraph;
    return sessionGraph;
  }
  return resolveSessionConfig(orchestratorConfig);
}

async function persistSessionGraph(
  chatSessionId: string | undefined,
  config: OrchestratorGraphConfig
): Promise<OrchestratorGraphConfig> {
  const normalized = normalizeOrchestratorConfig(config);
  setSessionOrchestratorConfig(normalized);
  if (chatSessionId) {
    await saveChatSessionGraph(chatSessionId, normalized);
  }
  return normalized;
}

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
  onAgentLensEvent?: (event: Record<string, unknown>) => void | Promise<void>,
  chatSessionId?: string
): Promise<void> {
  if (chatSessionId) {
    await appendChatMessage(chatSessionId, "assistant", content, runId);
  }
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

function extractModelText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : (c as { text?: string }).text ?? ""))
      .join("");
  }
  return String(content ?? "");
}

async function directOrchestratorReplyContent(
  task: string,
  graphConfig: OrchestratorGraphConfig
): Promise<string> {
  assertLlmReady();
  const model = getModel(false);
  const reply = await model.invoke([
    new SystemMessage(
      "You are the orchestrator assistant in an agent IDE. Answer clearly and concisely.\n" +
        "You have agents with tools including create_github_repo and init_git_repo — never tell users to manually create repos on github.com.\n\n" +
        graphContextForDirectReply(graphConfig.agents)
    ),
    new HumanMessage(task),
  ]);
  return extractModelText(reply.content).trim();
}

async function emitDirectOrchestratorReply(
  runId: string,
  task: string,
  graphConfig: OrchestratorGraphConfig,
  stepIndex: number,
  onAgentLensEvent?: (event: Record<string, unknown>) => void | Promise<void>,
  chatSessionId?: string
): Promise<void> {
  const content = await directOrchestratorReplyContent(task, graphConfig);
  await emitChatMessage(runId, content, stepIndex, onAgentLensEvent, chatSessionId);
}

async function applyGraphDesignFromPrompt(
  runId: string,
  task: string,
  graphConfig: OrchestratorGraphConfig,
  repoUrl: string,
  chatSessionId: string | undefined,
  onAgentLensEvent?: (event: Record<string, unknown>) => void | Promise<void>,
  stepIndex = 0
): Promise<OrchestratorGraphConfig> {
  assertLlmReady();
  const repoHint = repoHintFromTask(task, repoUrl);
  const { config: designedConfig, summary } = await designGraphFromPrompt(
    task,
    repoHint,
    graphConfig.agents.length ? graphConfig : null
  );
  const saved = await persistSessionGraph(chatSessionId, designedConfig);
  clearCompiledGraphCache();
  await emitGraphUpdated(runId, saved, "graph_design", stepIndex, onAgentLensEvent, chatSessionId);
  const agentLines = saved.agents
    .map((a) => `- **${a.label}** (\`${a.id}\`)`)
    .join("\n");
  await emitChatMessage(
    runId,
    `Updated the canvas with ${saved.agents.length} agent(s):\n${agentLines}\n\n${summary}`,
    stepIndex + 1,
    onAgentLensEvent,
    chatSessionId
  );
  return saved;
}

async function emitGraphUpdated(
  runId: string,
  config: OrchestratorGraphConfig,
  reason: string,
  stepIndex: number,
  onAgentLensEvent?: (event: Record<string, unknown>) => void | Promise<void>,
  chatSessionId?: string
): Promise<void> {
  if (chatSessionId) {
    await saveChatSessionGraph(chatSessionId, config);
  }
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
/** Run IDs whose workspace dir is session-scoped (do not delete on release). */
const sessionScopedRuns = new Set<string>();

export function releaseSessionWorkspace(runId: string): void {
  clearRunContext(runId);
  activeRuns.delete(runId);
  if (sessionScopedRuns.has(runId)) {
    sessionScopedRuns.delete(runId);
    return;
  }
  if (sessionWorkspaces.has(runId)) {
    sessionWorkspaces.delete(runId);
    const workspaceDir = join(env.WORKSPACE_ROOT, runId);
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
  const out: Record<string, unknown> = {
    run_id: runId,
    event: ev.event,
    name: ev.name,
    data: ev.data,
    metadata: ev.metadata,
    ts: Date.now(),
    step_index: stepIndex,
  };
  if (ev.event === "on_chain_end" || ev.event === "on_node_end") {
    const data = ev.data as { output?: unknown } | undefined;
    const snapshot = data?.output;
    if (snapshot && typeof snapshot === "object") {
      out.state_snapshot = snapshot;
    }
  }
  return out;
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
    chatSessionId?: string;
  },
  onAgentLensEvent?: (event: Record<string, unknown>) => void | Promise<void>
): Promise<void> {
  const { runId, projectId, task, repoUrl, githubToken, credentials = {} } = params;
  const keepWorkspace = params.keepWorkspace ?? false;
  const targetAgent = params.targetAgent;
  const orchestratorConfig = params.orchestratorConfig;
  const chatSessionId = params.chatSessionId;
  const editKey = pendingEditKey(chatSessionId, projectId);
  const branch = params.branch ?? `agent/run-${runId.slice(0, 8)}`;
  const sessionScoped = Boolean(chatSessionId);
  let workspaceDir: string;
  if (chatSessionId) {
    workspaceDir = await ensureWorkspaceForChatSession(chatSessionId, repoUrl, branch);
    sessionWorkspaces.add(chatSessionId);
    sessionScopedRuns.add(runId);
  } else {
    workspaceDir = join(env.WORKSPACE_ROOT, runId);
  }
  const db = getAppDb();

  await runWithCredentials(credentials, async () => {

  if (!existsSync(env.WORKSPACE_ROOT)) mkdirSync(env.WORKSPACE_ROOT, { recursive: true });
  if (!sessionScoped && !keepWorkspace && existsSync(workspaceDir)) {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
  if (!sessionScoped && keepWorkspace) sessionWorkspaces.add(runId);

  await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));

  setRunContext(runId, {
    workspaceDir,
    runId,
    projectId,
    repoUrl,
    githubToken,
    branch,
    chatSessionId,
    sessionScoped,
  });
  clearPipelineHandoffs(runId);

  if (chatSessionId) {
    await appendChatMessage(chatSessionId, "user", task, runId);
  }

  const controller = new AbortController();
  activeRuns.set(runId, controller);

  try {
    if (!sessionScoped) {
      prepareWorkspace(repoUrl, workspaceDir, branch);
    }
    clearCompiledGraphCache();

    let graphConfig = await resolveGraphForRun(chatSessionId, orchestratorConfig);

    // Pending confirmation check: user said "yes" to a pending NL edit.
    // Checked before classification to avoid wasting an LLM call on "yes" replies.
    const pending = pendingGraphEdits.get(editKey);
    if (pending && isConfirmation(task)) {
      pendingGraphEdits.delete(editKey);
      if (pending.command || pending.description.trim()) {
        assertLlmReady();
        const edited = await applyGraphChangeFromCommand(
          pending.command,
          pending.description,
          graphConfig,
          repoUrl
        );
        graphConfig = await persistSessionGraph(chatSessionId, edited.config);
        clearCompiledGraphCache();
        await emitGraphUpdated(runId, graphConfig, "graph_edit_confirmed", 0, onAgentLensEvent, chatSessionId);
        await emitChatMessage(runId, edited.message, 1, onAgentLensEvent, chatSessionId);
      } else {
        await emitChatMessage(
          runId,
          `Cancelled — I wasn't sure what to change. Try a more specific command.`,
          0,
          onAgentLensEvent,
          chatSessionId
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
      if (pendingGraphEdits.has(editKey)) {
        await emitChatMessage(runId, "_(Cancelled pending graph edit.)_", 0, onAgentLensEvent, chatSessionId);
      }
      pendingGraphEdits.delete(editKey);
      const cmd = intent.command;

      assertLlmReady();
      const edited = await applyGraphChangeFromCommand(cmd, task, graphConfig, repoUrl);
      graphConfig = await persistSessionGraph(chatSessionId, edited.config);
      clearCompiledGraphCache();
      const reason =
        cmd.type === "rebuild" ? "graph_rebuild" : cmd.type === "refine" ? "graph_refine" : `graph_edit_${cmd.type}`;
      await emitGraphUpdated(runId, graphConfig, reason, 0, onAgentLensEvent, chatSessionId);
      await emitChatMessage(runId, edited.message, 1, onAgentLensEvent, chatSessionId);
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    // NL graph edit — ask for confirmation.
    if (intent.kind === "graph_edit_pending") {
      const priorPending = pendingGraphEdits.get(editKey);
      let stepOffset = 0;
      if (priorPending) {
        await emitChatMessage(runId, "_(Cancelled pending graph edit.)_", 0, onAgentLensEvent, chatSessionId);
        stepOffset = 1;
      }
      pendingGraphEdits.delete(editKey);
      pendingGraphEdits.set(editKey, { description: intent.description, command: intent.command });
      const confirmMsg = `I'd ${intent.description}. Reply **yes** to apply or anything else to cancel.`;
      await emitChatMessage(runId, confirmMsg, stepOffset, onAgentLensEvent, chatSessionId);
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    // Graph design — create or extend team structure; auto-run pipeline when a product is requested too.
    if (intent.kind === "graph_design") {
      if (pendingGraphEdits.has(editKey)) {
        await emitChatMessage(runId, "_(Cancelled pending graph edit.)_", 0, onAgentLensEvent, chatSessionId);
      }
      pendingGraphEdits.delete(editKey);
      graphConfig = await applyGraphDesignFromPrompt(
        runId,
        task,
        graphConfig,
        repoUrl,
        chatSessionId,
        onAgentLensEvent,
        0
      );
      if (!looksLikeProductDeliverable(task)) {
        await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
        emit(runId, { type: "run_completed", status: "completed" });
        return;
      }
      // Fall through to task_run — team is on canvas, now execute the deliverable.
    } else if (intent.kind === "q_and_a") {
      const priorPendingQa = pendingGraphEdits.get(editKey);
      let qaStepOffset = 0;
      if (priorPendingQa) {
        await emitChatMessage(runId, "_(Cancelled pending graph edit.)_", 0, onAgentLensEvent, chatSessionId);
        qaStepOffset = 1;
      }
      pendingGraphEdits.delete(editKey);
      await emitDirectOrchestratorReply(
        runId,
        task,
        graphConfig,
        qaStepOffset,
        onAgentLensEvent,
        chatSessionId
      );
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    // task_run — only enter pipeline when execution is actually needed.
    if (pendingGraphEdits.has(editKey)) {
      await emitChatMessage(runId, "_(Cancelled pending graph edit.)_", 0, onAgentLensEvent, chatSessionId);
    }
    pendingGraphEdits.delete(editKey);

    if (
      !shouldExecutePipeline({
        task,
        graphConfig,
        targetAgent,
        intentKind: "task_run",
      })
    ) {
      await emitDirectOrchestratorReply(runId, task, graphConfig, 0, onAgentLensEvent, chatSessionId);
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    assertLlmReady();
    if (isBlankGraph(graphConfig)) {
      const repoHint = repoHintFromTask(task, repoUrl);
      const { config: designedConfig } = await designGraphFromPrompt(task, repoHint);
      graphConfig = await persistSessionGraph(chatSessionId, designedConfig);
      clearCompiledGraphCache();

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
      callbacks: (handler ? [handler] : []) as Callbacks,
      signal: controller.signal,
      recursionLimit: GRAPH_RECURSION_LIMIT,
    };

    let githubPrUrl: string | undefined;
    let stepIndex = 0;
    const traceId = (handler as { last_trace_id?: string } | null)?.last_trace_id;

    const graph = getCompiledGraph(graphConfig, targetAgent, repoUrl);
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
      const handoffText = formatHandoffsForPrompt(getPipelineHandoffs(runId));
      const notes = [
        pipelineNotes.length ? pipelineNotes.join("\n\n---\n\n") : "",
        handoffText !== "(no upstream handoffs yet)" ? `## Pipeline handoffs\n${handoffText}` : "",
      ]
        .filter(Boolean)
        .join("\n\n---\n\n");
      if (notes) {
        const finalAnswer = await synthesizeFinalChatAnswer(task, notes);
        await emitChatMessage(runId, finalAnswer, stepIndex + 1, onAgentLensEvent, chatSessionId);
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
    if (isLlmAuthError(err)) {
      await recoverCopilotAuth();
    }
    const message = formatLlmError(err);
    try {
      await emitChatMessage(runId, message, 0, onAgentLensEvent, chatSessionId);
    } catch {
      // best-effort chat error surface
    }
    await db
      .update(runs)
      .set({ status: "failed", error: message, completedAt: new Date() })
      .where(eq(runs.id, runId));
    emit(runId, { type: "run_failed", error: message });
    throw err;
  } finally {
    clearRunContext(runId);
    activeRuns.delete(runId);
    sessionScopedRuns.delete(runId);
    if (!sessionScoped && !keepWorkspace && existsSync(workspaceDir)) {
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
  chatSessionId?: string;
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

  const chatSessionId = run.chatSessionId ?? undefined;
  const editKey = pendingEditKey(chatSessionId, run.projectId);

  if (chatSessionId) {
    await appendChatMessage(chatSessionId, "user", task, runId);
  }

  // --- Pending confirmation ---
  const pending2 = pendingGraphEdits.get(editKey);
  if (pending2 && isConfirmation(task)) {
    pendingGraphEdits.delete(editKey);
    const base2 = await resolveGraphForRun(chatSessionId, orchestratorConfig);
    if (pending2.command || pending2.description.trim()) {
      assertLlmReady();
      const edited2 = await applyGraphChangeFromCommand(
        pending2.command,
        pending2.description,
        base2,
        project.repoUrl
      );
      const saved2 = await persistSessionGraph(chatSessionId, edited2.config);
      clearCompiledGraphCache();
      const schema2 = getGraphSchemaFromConfig(saved2);
      yield {
        run_id: runId,
        event: "orchestrator_graph_updated",
        name: "graph_edit",
        data: {
          config: saved2,
          schema: schema2,
          reason: "graph_edit_confirmed",
          deployed: true,
          agent_ids: saved2.agents.map((a: CustomAgentConfig) => a.id),
        },
        ts: Date.now(),
        step_index: 0,
      };
      if (chatSessionId) {
        await appendChatMessage(chatSessionId, "assistant", edited2.message, runId);
      }
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
  const base = await resolveGraphForRun(chatSessionId, orchestratorConfig);
  const intent2 = await classifyMessageIntent(task, base.agents);

  if (intent2.kind === "graph_edit") {
    if (pendingGraphEdits.has(editKey)) {
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
    pendingGraphEdits.delete(editKey);
    const cmd2 = intent2.command;
    assertLlmReady();
    const edited3 = await applyGraphChangeFromCommand(cmd2, task, base, project.repoUrl);
    const saved3 = await persistSessionGraph(chatSessionId, edited3.config);
    clearCompiledGraphCache();
    const schema3 = getGraphSchemaFromConfig(saved3);
    const reason3 =
      cmd2.type === "rebuild" ? "graph_rebuild" : cmd2.type === "refine" ? "graph_refine" : `graph_edit_${cmd2.type}`;
    yield {
      run_id: runId,
      event: "orchestrator_graph_updated",
      name: "graph_edit",
      data: {
        config: saved3,
        schema: schema3,
        reason: reason3,
        deployed: true,
        agent_ids: saved3.agents.map((a: CustomAgentConfig) => a.id),
      },
      ts: Date.now(),
      step_index: 0,
    };
    if (chatSessionId) await appendChatMessage(chatSessionId, "assistant", edited3.message, runId);
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
    if (pendingGraphEdits.has(editKey)) {
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
    pendingGraphEdits.delete(editKey);
    pendingGraphEdits.set(editKey, {
      description: intent2.description,
      command: intent2.command,
    });
    const confirmMsg2 = `I'd ${intent2.description}. Reply **yes** to apply or anything else to cancel.`;
    if (chatSessionId) await appendChatMessage(chatSessionId, "assistant", confirmMsg2, runId);
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

  if (intent2.kind === "graph_design") {
    if (pendingGraphEdits.has(editKey)) {
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
    pendingGraphEdits.delete(editKey);
    assertLlmReady();
    const { config: designed, summary } = await designGraphFromPrompt(
      task,
      repoHintFromTask(task, project.repoUrl),
      base.agents.length ? base : null
    );
    const savedDesign = await persistSessionGraph(chatSessionId, designed);
    clearCompiledGraphCache();
    const schemaDesign = getGraphSchemaFromConfig(savedDesign);
    yield {
      run_id: runId,
      event: "orchestrator_graph_updated",
      name: "graph_edit",
      data: {
        config: savedDesign,
        schema: schemaDesign,
        reason: "graph_design",
        deployed: true,
        agent_ids: savedDesign.agents.map((a: CustomAgentConfig) => a.id),
      },
      ts: Date.now(),
      step_index: 0,
    };
    const designMsg = `Updated the canvas with ${savedDesign.agents.length} agent(s):\n${savedDesign.agents
      .map((a) => `- **${a.label}** (\`${a.id}\`)`)
      .join("\n")}\n\n${summary}`;
    if (chatSessionId) await appendChatMessage(chatSessionId, "assistant", designMsg, runId);
    yield {
      run_id: runId,
      event: "on_chat_model_end",
      name: "supervisor",
      data: { output: { content: designMsg } },
      metadata: { langgraph_node: "supervisor" },
      ts: Date.now(),
      step_index: 1,
    };
    if (!looksLikeProductDeliverable(task)) {
      await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
      return;
    }
    orchestratorConfig = savedDesign;
    // Fall through to task_run — team is on canvas, now execute the deliverable.
  } else if (intent2.kind === "q_and_a") {
    if (pendingGraphEdits.has(editKey)) {
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
    pendingGraphEdits.delete(editKey);
    const qContent = await directOrchestratorReplyContent(task, base);
    if (chatSessionId) await appendChatMessage(chatSessionId, "assistant", qContent, runId);
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

  // task_run: only pipeline when execution is actually needed.
  if (pendingGraphEdits.has(editKey)) {
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
  pendingGraphEdits.delete(editKey);

  const pipelineGraph =
    intent2.kind === "graph_design"
      ? normalizeOrchestratorConfig(orchestratorConfig ?? base)
      : base;

  if (
    !shouldExecutePipeline({
      task,
      graphConfig: pipelineGraph,
      targetAgent: targetWorker,
      intentKind: "task_run",
    })
  ) {
    const directContent = await directOrchestratorReplyContent(task, pipelineGraph);
    if (chatSessionId) await appendChatMessage(chatSessionId, "assistant", directContent, runId);
    yield {
      run_id: runId,
      event: "on_chat_model_end",
      name: "supervisor",
      data: { output: { content: directContent } },
      metadata: { langgraph_node: "supervisor" },
      ts: Date.now(),
      step_index: 0,
    };
    await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
    return;
  }

  let graphForRun =
    intent2.kind === "graph_design"
      ? normalizeOrchestratorConfig(orchestratorConfig ?? base)
      : base;
  if (isBlankGraph(graphForRun)) {
    assertLlmReady();
    const { config: freshForRun } = await designGraphFromPrompt(
      task,
      repoHintFromTask(task, project.repoUrl)
    );
    graphForRun = await persistSessionGraph(chatSessionId, freshForRun);
    clearCompiledGraphCache();
    const schemaNew = getGraphSchemaFromConfig(graphForRun);
    yield {
      run_id: runId,
      event: "orchestrator_graph_updated",
      name: "auto_deploy",
      data: {
        config: graphForRun,
        schema: schemaNew,
        reason: "task_run_design",
        deployed: true,
        agent_ids: graphForRun.agents.map((a: CustomAgentConfig) => a.id),
      },
      ts: Date.now(),
      step_index: 0,
    };
  }
  orchestratorConfig = graphForRun;

  const githubToken = credentials.githubToken ?? env.GITHUB_TOKEN ?? "";
  if ((isRemoteRepo(project.repoUrl) || taskNeedsGithubToken(task)) && !githubToken) {
    throw new Error("GitHub token required for repo creation, push, or PR.");
  }

  const branch = run.branch ?? `agent/run-${runId.slice(0, 8)}`;
  const sessionScopedFollowUp = Boolean(chatSessionId);
  let workspaceDir: string;
  if (chatSessionId) {
    workspaceDir = await ensureWorkspaceForChatSession(chatSessionId, project.repoUrl, branch);
    sessionWorkspaces.add(chatSessionId);
    sessionScopedRuns.add(runId);
  } else {
    workspaceDir = join(env.WORKSPACE_ROOT, runId);
  }
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
    if (!sessionScopedFollowUp) {
      sessionWorkspaces.add(runId);
      prepareWorkspace(project.repoUrl, workspaceDir, branch);
    }

    setRunContext(runId, {
      workspaceDir,
      runId,
      projectId: run.projectId,
      repoUrl: project.repoUrl,
      githubToken,
      branch,
      chatSessionId,
      sessionScoped: sessionScopedFollowUp,
    });

    await db.update(runs).set({ status: "running", error: null }).where(eq(runs.id, runId));

    const controller = new AbortController();
    activeRuns.set(runId, controller);

    try {
      clearCompiledGraphCache();
      const graph = getCompiledGraph(orchestratorConfig, targetWorker, project.repoUrl);
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
        callbacks: (handler ? [handler] : []) as Callbacks,
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
      if (dm2?.type === "chat" || dm2?.type === "both") {
        const handoffText2 = formatHandoffsForPrompt(getPipelineHandoffs(runId));
        const notes2 = [
          pipelineNotes2.length ? pipelineNotes2.join("\n\n---\n\n") : "",
          handoffText2 !== "(no upstream handoffs yet)" ? `## Pipeline handoffs\n${handoffText2}` : "",
        ]
          .filter(Boolean)
          .join("\n\n---\n\n");
        if (notes2) {
          const finalAnswer2 = await synthesizeFinalChatAnswer(task, notes2);
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
      if (isLlmAuthError(err)) {
        await recoverCopilotAuth();
      }
      const message = formatLlmError(err);
      push({
        run_id: runId,
        event: "on_chat_model_end",
        name: "supervisor",
        data: { output: { content: message } },
        metadata: { langgraph_node: "supervisor" },
        ts: Date.now(),
        step_index: 0,
      });
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

export async function deleteRun(runId: string): Promise<void> {
  const db = getAppDb();
  await db.delete(events).where(eq(events.runId, runId));
  await db.update(chatMessages).set({ runId: null }).where(eq(chatMessages.runId, runId));
  await db.delete(runs).where(eq(runs.id, runId));
  releaseSessionWorkspace(runId);
}

import {
  loadCredentials,
  credentialsToPayload,
  credentialsHeaders,
  type StoredCredentials,
} from "../lib/credentials";
import type { OrchestratorGraphConfig, SkillDefinition } from "../lib/types/orchestrator";
import type { RunEvent } from "../lib/types/run";
import { apiBaseUrl, isAwsBackend, wsBaseUrl } from "../lib/auth/config";
import { getIdTokenSync, getValidIdToken } from "../lib/auth/cognito";

const API_BASE = apiBaseUrl();
const WS_BASE = wsBaseUrl();

function getCredentials(): StoredCredentials {
  return loadCredentials();
}

/** Authenticated fetch — attaches Cognito ID token when running against API Gateway. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? undefined);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (isAwsBackend()) {
    const token = await getValidIdToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, { ...init, headers });
}

/**
 * WebSocket URL.
 * Local Fastify: ws://host/ws/run
 * API Gateway: wss://…/dev?token=<id_token>
 */
export function buildWsUrl(path: string): string {
  if (isAwsBackend()) {
    const token = getIdTokenSync();
    const base = WS_BASE;
    if (!token) return base;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}token=${encodeURIComponent(token)}`;
  }
  return `${WS_BASE}${path}`;
}

export async function runAgent(question: string) {
  const credentials = getCredentials();
  const headers = isAwsBackend()
    ? { "Content-Type": "application/json" }
    : credentialsHeaders(credentials);
  const res = await apiFetch("/api/run-agent", {
    method: "POST",
    headers,
    body: JSON.stringify({
      question,
      ...(isAwsBackend() ? {} : { credentials: credentialsToPayload(credentials) }),
    }),
  });
  return res.json();
}

export function openRunWebsocket(question: string) {
  const credentials = getCredentials();
  const ws = new WebSocket(buildWsUrl("/ws/run"));
  ws.onopen = () =>
    ws.send(
      JSON.stringify(
        isAwsBackend()
          ? { action: "chat", prompt: question, type: "start", question }
          : {
              question,
              credentials: credentialsToPayload(credentials),
            }
      )
    );
  return ws;
}

export type RunLaunchOptions = {
  targetAgent?: string;
  orchestratorConfig?: OrchestratorGraphConfig;
  chatSessionId?: string;
  projectId?: string;
};

export type RunSessionCallbacks = {
  onEvent: (event: RunEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (message: string) => void;
};

export class RunSessionWebsocket {
  private ws: WebSocket | null = null;
  private callbacks: RunSessionCallbacks;
  private ready = false;
  private pendingStart: string | null = null;
  private pendingOptions: RunLaunchOptions | null = null;
  private chatSessionId: string | null = null;

  constructor(callbacks: RunSessionCallbacks) {
    this.callbacks = callbacks;
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(buildWsUrl("/ws/run"));
    this.ws.onopen = () => {
      this.ready = true;
      this.callbacks.onOpen?.();
      if (this.pendingStart) {
        const question = this.pendingStart;
        const options = this.pendingOptions ?? undefined;
        this.pendingStart = null;
        this.pendingOptions = null;
        this.sendStart(question, options);
      }
    };
    this.ws.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as RunEvent & {
        event?: string;
        data?: { chat_session_id?: string };
      };
      if (event.event === "chat_session_bound" && event.data?.chat_session_id) {
        this.chatSessionId = event.data.chat_session_id;
        return;
      }
      if (event.event === "project_bound" && event.data?.project_id) {
        return;
      }
      if (event.event === "error") {
        const message =
          (event.data as { message?: string } | undefined)?.message ?? "Unknown error";
        this.callbacks.onError?.(message);
        return;
      }
      this.callbacks.onEvent(event);
    };
    this.ws.onclose = () => {
      this.ready = false;
      this.callbacks.onClose?.();
    };
    this.ws.onerror = () => {
      this.callbacks.onError?.("WebSocket connection error");
    };
  }

  sendStart(question: string, options?: RunLaunchOptions) {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.pendingStart = question;
      this.pendingOptions = options ?? null;
      this.connect();
      return;
    }
    if (!this.ready) {
      this.pendingStart = question;
      this.pendingOptions = options ?? null;
      return;
    }
    this.ws.send(
      JSON.stringify(
        isAwsBackend()
          ? {
              action: "chat",
              type: "start",
              prompt: question,
              question,
              target_agent: options?.targetAgent,
              orchestrator_config: options?.orchestratorConfig,
              chat_session_id: options?.chatSessionId ?? this.chatSessionId ?? undefined,
              project_id: options?.projectId ?? undefined,
            }
          : {
              type: "start",
              question,
              credentials: credentialsToPayload(getCredentials()),
              target_agent: options?.targetAgent,
              orchestrator_config: options?.orchestratorConfig,
              chat_session_id: options?.chatSessionId ?? this.chatSessionId ?? undefined,
              project_id: options?.projectId ?? undefined,
            }
      )
    );
  }

  sendFollowUp(question: string, options?: RunLaunchOptions) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks.onError?.("Not connected to orchestrator session");
      return;
    }
    this.ws.send(
      JSON.stringify(
        isAwsBackend()
          ? {
              action: "chat",
              type: "follow_up",
              prompt: question,
              question,
              target_agent: options?.targetAgent,
              orchestrator_config: options?.orchestratorConfig,
              chat_session_id: options?.chatSessionId ?? this.chatSessionId ?? undefined,
              project_id: options?.projectId ?? undefined,
            }
          : {
              type: "follow_up",
              question,
              credentials: credentialsToPayload(getCredentials()),
              target_agent: options?.targetAgent,
              orchestrator_config: options?.orchestratorConfig,
              chat_session_id: options?.chatSessionId ?? this.chatSessionId ?? undefined,
              project_id: options?.projectId ?? undefined,
            }
      )
    );
  }

  close() {
    this.ws?.close();
    this.ws = null;
    this.ready = false;
  }
}

export async function fetchRuns() {
  const res = await apiFetch("/api/runs");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchCredentialsStatus(credentials?: StoredCredentials) {
  const creds = credentials ?? getCredentials();
  const res = await apiFetch("/api/settings/status", {
    method: "POST",
    headers: isAwsBackend() ? { "Content-Type": "application/json" } : credentialsHeaders(creds),
    body: JSON.stringify({ credentials: credentialsToPayload(creds) }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchRoutingPolicy() {
  const res = await apiFetch("/api/settings/routing");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

export function wsUrl(path: string) {
  return buildWsUrl(path);
}

export async function fetchRunTrace(runId: string) {
  const res = await apiFetch(`/api/trace/${runId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function subscribeRunStream(runId: string, onEvent: (event: unknown) => void) {
  const ws = new WebSocket(buildWsUrl(`/runs/${runId}/stream`));
  ws.onmessage = (msg) => onEvent(JSON.parse(msg.data));
  return ws;
}

export type ChatSessionSummary = {
  id: string;
  project_id?: string | null;
  title?: string | null;
  agent_count: number;
  message_count: number;
  created_at: string;
  updated_at: string;
};

export async function fetchChatSessions(): Promise<ChatSessionSummary[]> {
  const res = await apiFetch("/api/chat-sessions");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateChatSessionTitle(
  sessionId: string,
  title: string
): Promise<void> {
  const res = await apiFetch(`/api/chat-sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function duplicateChatSession(
  sessionId: string,
  title?: string
): Promise<{ id: string; title: string | null }> {
  const res = await apiFetch(`/api/chat-sessions/${sessionId}/duplicate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const res = await apiFetch(`/api/chat-sessions/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function deleteRun(runId: string): Promise<void> {
  const res = await apiFetch(`/api/runs/${runId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export type ChatSessionResponse = {
  id: string;
  project_id?: string | null;
  title?: string | null;
  config: OrchestratorGraphConfig;
  schema: unknown;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    run_id?: string | null;
    ts: number;
  }>;
  available_tools?: string[];
  available_skills?: SkillDefinition[];
};

export async function createChatSession(
  options?: { title?: string; project_id?: string }
): Promise<ChatSessionResponse> {
  const res = await apiFetch("/api/chat-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options ?? {}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchChatSession(sessionId: string): Promise<ChatSessionResponse> {
  const res = await apiFetch(`/api/chat-sessions/${sessionId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveChatSessionGraph(
  sessionId: string,
  config: OrchestratorGraphConfig
): Promise<OrchestratorGraphConfig> {
  const res = await apiFetch(`/api/chat-sessions/${sessionId}/graph`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.config as OrchestratorGraphConfig;
}

export type SavedGraphTemplateSummary = {
  id: string;
  name: string;
  description: string;
  agent_count: number;
  source_session_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function fetchSavedGraphTemplates(): Promise<SavedGraphTemplateSummary[]> {
  const res = await apiFetch("/api/graph-templates");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Explicit save — stores current graph as a reusable infrastructure template. */
export async function saveGraphTemplate(params: {
  name: string;
  description?: string;
  sessionId?: string;
  config?: OrchestratorGraphConfig;
}): Promise<{ id: string; name: string; agent_count: number }> {
  const res = await apiFetch("/api/graph-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      description: params.description,
      session_id: params.sessionId,
      config: params.config,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text) as { error?: string };
      throw new Error(err.error ?? text);
    } catch (e) {
      if (e instanceof Error && e.message !== text) throw e;
      throw new Error(text || "Failed to save infrastructure");
    }
  }
  return res.json();
}

export async function deleteSavedGraphTemplate(templateId: string): Promise<void> {
  const res = await apiFetch(`/api/graph-templates/${templateId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function openSavedGraphTemplate(
  templateId: string,
  projectId: string,
  title?: string
): Promise<{ session_id: string; project_id: string; config: OrchestratorGraphConfig }> {
  const res = await apiFetch(`/api/graph-templates/${templateId}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId, ...(title ? { title } : {}) }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type ProjectSummary = {
  id: string;
  name: string;
  repo_url: string;
  source_type: "github" | "local";
  default_branch: string;
  created_at: string;
};

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const res = await apiFetch("/api/projects");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createProject(params: {
  name?: string;
  repo_url: string;
  default_branch?: string;
}): Promise<ProjectSummary> {
  const res = await apiFetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text) as { error?: string };
      throw new Error(err.error ?? text);
    } catch (e) {
      if (e instanceof Error && e.message !== text) throw e;
      throw new Error(text || "Failed to create project");
    }
  }
  return res.json();
}

export async function openProject(
  projectId: string,
  title?: string
): Promise<{ project_id: string; session_id: string; title: string | null; repo_url: string }> {
  const res = await apiFetch(`/api/projects/${projectId}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${projectId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function applySavedGraphTemplate(
  templateId: string,
  sessionId: string
): Promise<{ config: OrchestratorGraphConfig; template_name: string }> {
  const res = await apiFetch(`/api/graph-templates/${templateId}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type WorkspaceTreeNode =
  | { type: "file"; name: string; path: string }
  | { type: "dir"; name: string; path: string; children: WorkspaceTreeNode[] };

export type WorkspaceFileChangeSummary = {
  id: string;
  run_id: string | null;
  agent_id: string;
  path: string;
  action: string;
  created_at: string | null;
};

export type WorkspaceFileChangeDetail = WorkspaceFileChangeSummary & {
  before: string;
  after: string;
};

export async function fetchWorkspaceTree(sessionId: string): Promise<WorkspaceTreeNode[]> {
  const res = await apiFetch(`/api/chat-sessions/${sessionId}/workspace/tree`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.tree as WorkspaceTreeNode[];
}

export async function fetchWorkspaceFile(
  sessionId: string,
  path: string
): Promise<{
  path: string;
  encoding: "utf-8" | "base64";
  content: string;
  mime?: string;
  size?: number;
  git_diff: string | null;
}> {
  const res = await apiFetch(
    `/api/chat-sessions/${sessionId}/workspace/file?path=${encodeURIComponent(path)}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createWorkspaceFile(
  sessionId: string,
  path: string,
  content: string
): Promise<void> {
  const res = await apiFetch(`/api/chat-sessions/${sessionId}/workspace/file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function saveWorkspaceFile(
  sessionId: string,
  path: string,
  content: string
): Promise<void> {
  const res = await apiFetch(`/api/chat-sessions/${sessionId}/workspace/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export function workspaceFileDownloadUrl(sessionId: string, path: string): string {
  return apiUrl(
    `/api/chat-sessions/${sessionId}/workspace/file/download?path=${encodeURIComponent(path)}`
  );
}

export function workspaceZipExportUrl(sessionId: string): string {
  return apiUrl(`/api/chat-sessions/${sessionId}/workspace/export/zip`);
}

export type WorkspaceOutputSummary = {
  id: string;
  path: string;
  agent_id: string;
  action: string;
  created_at: string | null;
};

export async function fetchWorkspaceOutputs(sessionId: string): Promise<{
  deliverable_files: string[];
  recent: WorkspaceOutputSummary[];
}> {
  const res = await apiFetch(`/api/chat-sessions/${sessionId}/workspace/outputs`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchWorkspaceChanges(
  sessionId: string
): Promise<WorkspaceFileChangeSummary[]> {
  const res = await apiFetch(`/api/chat-sessions/${sessionId}/workspace/changes`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.changes as WorkspaceFileChangeSummary[];
}

export async function fetchWorkspaceChangeDetail(
  sessionId: string,
  changeId: string
): Promise<WorkspaceFileChangeDetail> {
  const res = await apiFetch(`/api/chat-sessions/${sessionId}/workspace/changes/${changeId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

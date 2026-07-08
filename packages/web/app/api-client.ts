import {
  loadCredentials,
  credentialsToPayload,
  credentialsHeaders,
  type StoredCredentials,
} from "../lib/credentials";
import type { OrchestratorGraphConfig } from "../lib/types/orchestrator";
import type { RunEvent } from "../lib/types/run";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

function getCredentials(): StoredCredentials {
  return loadCredentials();
}

export async function runAgent(question: string) {
  const credentials = getCredentials();
  const res = await fetch(`${API_BASE}/api/run-agent`, {
    method: "POST",
    headers: credentialsHeaders(credentials),
    body: JSON.stringify({
      question,
      credentials: credentialsToPayload(credentials),
    }),
  });
  return res.json();
}

export function openRunWebsocket(question: string) {
  const credentials = getCredentials();
  const ws = new WebSocket(`${WS_BASE}/ws/run`);
  ws.onopen = () =>
    ws.send(
      JSON.stringify({
        question,
        credentials: credentialsToPayload(credentials),
      })
    );
  return ws;
}

export type RunLaunchOptions = {
  targetAgent?: string;
  orchestratorConfig?: OrchestratorGraphConfig;
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

  constructor(callbacks: RunSessionCallbacks) {
    this.callbacks = callbacks;
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(`${WS_BASE}/ws/run`);
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
      const event = JSON.parse(msg.data) as RunEvent;
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
      JSON.stringify({
        type: "start",
        question,
        credentials: credentialsToPayload(getCredentials()),
        target_agent: options?.targetAgent,
        orchestrator_config: options?.orchestratorConfig,
      })
    );
  }

  sendFollowUp(question: string, options?: RunLaunchOptions) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks.onError?.("Not connected to orchestrator session");
      return;
    }
    this.ws.send(
      JSON.stringify({
        type: "follow_up",
        question,
        credentials: credentialsToPayload(getCredentials()),
        target_agent: options?.targetAgent,
        orchestrator_config: options?.orchestratorConfig,
      })
    );
  }

  close() {
    this.ws?.close();
    this.ws = null;
    this.ready = false;
  }
}

export async function fetchRuns() {
  const res = await fetch(`${API_BASE}/api/runs`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchCredentialsStatus(credentials?: StoredCredentials) {
  const creds = credentials ?? getCredentials();
  const res = await fetch(`${API_BASE}/api/settings/status`, {
    method: "POST",
    headers: credentialsHeaders(creds),
    body: JSON.stringify({ credentials: credentialsToPayload(creds) }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchRoutingPolicy() {
  const res = await fetch(`${API_BASE}/api/settings/routing`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

export function wsUrl(path: string) {
  return `${WS_BASE}${path}`;
}

export async function fetchRunTrace(runId: string) {
  const res = await fetch(apiUrl(`/api/trace/${runId}`));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function subscribeRunStream(runId: string, onEvent: (event: unknown) => void) {
  const ws = new WebSocket(wsUrl(`/runs/${runId}/stream`));
  ws.onmessage = (msg) => onEvent(JSON.parse(msg.data));
  return ws;
}

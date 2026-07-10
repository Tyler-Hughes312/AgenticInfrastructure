"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createChatSession,
  fetchChatSession,
  openProject as openProjectApi,
  type ChatSessionResponse,
} from "../../app/api-client";
import type { ChatMessage } from "../../lib/types/chat";
import { OrchestratorProvider } from "../orchestrator/OrchestratorProvider";
import OrchestratorGraphSync from "../orchestrator/OrchestratorGraphSync";
import { RunSessionProvider } from "../run/RunSessionProvider";

const SESSION_STORAGE_KEY = "agentic.activeChatSession";
const PROJECT_STORAGE_KEY = "agentic.activeProject";

type ChatSessionContextValue = {
  sessionId: string | null;
  projectId: string | null;
  messages: ChatMessage[];
  loading: boolean;
  startNewSession: () => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  openProjectSession: (projectId: string) => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
};

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

function mapServerMessages(
  rows: ChatSessionResponse["messages"]
): ChatMessage[] {
  return rows.map((m) => ({
    id: m.id,
    role: m.role as ChatMessage["role"],
    content: m.content,
    ts: m.ts,
    runId: m.run_id ?? undefined,
  }));
}

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [initialConfig, setInitialConfig] = useState<
    ChatSessionResponse["config"] | null
  >(null);
  const [loading, setLoading] = useState(true);

  const bindSessionToUrl = useCallback(
    (id: string, projId?: string | null) => {
      if (typeof window !== "undefined") {
        sessionStorage.setItem(SESSION_STORAGE_KEY, id);
        if (projId) sessionStorage.setItem(PROJECT_STORAGE_KEY, projId);
        else sessionStorage.removeItem(PROJECT_STORAGE_KEY);
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set("session", id);
      if (projId) params.set("project", projId);
      else params.delete("project");
      const pathname =
        typeof window !== "undefined" ? window.location.pathname || "/" : "/";
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const loadSession = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const data = await fetchChatSession(id);
        setSessionId(data.id);
        setProjectId(data.project_id ?? null);
        setInitialConfig(data.config);
        setMessages(mapServerMessages(data.messages));
        bindSessionToUrl(data.id, data.project_id);
      } catch {
        router.replace("/projects");
      } finally {
        setLoading(false);
      }
    },
    [bindSessionToUrl, router]
  );

  const openProjectSession = useCallback(
    async (projId: string) => {
      setLoading(true);
      try {
        const opened = await openProjectApi(projId);
        await loadSession(opened.session_id);
      } catch {
        router.replace("/projects");
      } finally {
        setLoading(false);
      }
    },
    [loadSession, router]
  );

  const startNewSession = useCallback(async () => {
    if (projectId) {
      await openProjectSession(projectId);
      return;
    }
    router.push("/projects");
  }, [openProjectSession, projectId, router]);

  useEffect(() => {
    const fromUrlSession = searchParams.get("session");
    const fromUrlProject = searchParams.get("project");

    if (fromUrlSession) {
      if (fromUrlSession !== sessionId) {
        void loadSession(fromUrlSession);
      }
      return;
    }

    if (fromUrlProject && !sessionId) {
      void openProjectSession(fromUrlProject);
      return;
    }

    if (sessionId) return;

    const storedSession =
      typeof window !== "undefined" ? sessionStorage.getItem(SESSION_STORAGE_KEY) : null;
    if (storedSession) {
      void loadSession(storedSession);
      return;
    }

    if (typeof window !== "undefined" && window.location.pathname === "/") {
      router.replace("/projects");
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init from URL once per navigation
  }, [searchParams]);

  const value = useMemo(
    () => ({
      sessionId,
      projectId,
      messages,
      loading,
      startNewSession,
      openSession: loadSession,
      openProjectSession,
      setMessages,
    }),
    [sessionId, projectId, messages, loading, startNewSession, loadSession, openProjectSession]
  );

  if (loading && !sessionId && searchParams.get("session")) {
    return (
      <div className="h-screen bg-charcoal-bg text-charcoal-muted flex items-center justify-center">
        Loading chat session...
      </div>
    );
  }

  return (
    <ChatSessionContext.Provider value={value}>
      <OrchestratorProvider sessionId={sessionId} initialConfig={initialConfig}>
        <RunSessionProvider>
          <OrchestratorGraphSync />
          {children}
        </RunSessionProvider>
      </OrchestratorProvider>
    </ChatSessionContext.Provider>
  );
}

export function useChatSession() {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSession must be used within ChatSessionProvider");
  return ctx;
}

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
import { apiUrl } from "../../app/api-client";
import { getAvailableModelOptions } from "../../lib/orchestrator-models";
import type {
  CustomAgentConfig,
  GraphEdgeConfig,
  OrchestratorGraphConfig,
  OrchestratorGraphResponse,
} from "../../lib/types/orchestrator";

const STORAGE_KEY = "orchestrator-graph-config";

type OrchestratorContextValue = {
  config: OrchestratorGraphConfig;
  availableTools: string[];
  availableModels: string[];
  loading: boolean;
  saveConfig: (next: OrchestratorGraphConfig) => Promise<void>;
  applyRemoteConfig: (next: OrchestratorGraphConfig) => void;
  updateAgentPosition: (agentId: string, position: { x: number; y: number }) => void;
  addAgent: (agent: CustomAgentConfig) => Promise<void>;
  removeAgent: (agentId: string) => Promise<void>;
  addEdge: (edge: GraphEdgeConfig) => Promise<void>;
  removeEdge: (source: string, target: string) => Promise<void>;
  resetToDefault: () => Promise<void>;
  agentIds: string[];
};

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

function isLegacyLoopingConfig(config: OrchestratorGraphConfig): boolean {
  const ids = new Set(config.agents.map((a) => a.id));
  return ids.has("coder") && ids.has("reviewer") && ids.has("pr_opener");
}

function loadStoredConfig(): OrchestratorGraphConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrchestratorGraphConfig;
    // Drop the old coder⇄reviewer loop from prior defaults.
    if (isLegacyLoopingConfig(parsed)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function storeConfig(config: OrchestratorGraphConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

async function fetchGraph(): Promise<OrchestratorGraphResponse> {
  const res = await fetch(apiUrl("/api/orchestrator/graph"));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function putGraph(config: OrchestratorGraphConfig): Promise<OrchestratorGraphConfig> {
  const res = await fetch(apiUrl("/api/orchestrator/graph"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.config as OrchestratorGraphConfig;
}

export function OrchestratorProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<OrchestratorGraphConfig>({ agents: [], edges: [] });
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const availableModels = useMemo(() => getAvailableModelOptions(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await fetchGraph();
        if (cancelled) return;
        const stored = loadStoredConfig();
        // Prefer blank server default; only keep stored if user customized a non-legacy graph.
        const merged =
          stored && stored.agents.length > 0 && !isLegacyLoopingConfig(stored)
            ? stored
            : remote.config ?? { agents: [], edges: [] };
        setConfig(merged);
        setAvailableTools(remote.available_tools ?? []);
        storeConfig(merged);
        await putGraph(merged);
      } catch (err) {
        console.error("Failed to load orchestrator graph:", err);
        const stored = loadStoredConfig();
        if (stored?.agents?.length) setConfig(stored);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveConfig = useCallback(async (next: OrchestratorGraphConfig) => {
    const saved = await putGraph(next);
    setConfig(saved);
    storeConfig(saved);
  }, []);

  const applyRemoteConfig = useCallback((next: OrchestratorGraphConfig) => {
    setConfig(next);
    storeConfig(next);
  }, []);

  const updateAgentPosition = useCallback(
    (agentId: string, position: { x: number; y: number }) => {
      setConfig((prev) => {
        const agents = prev.agents.map((a) =>
          a.id === agentId ? { ...a, position } : a
        );
        const next = { ...prev, agents };
        storeConfig(next);
        return next;
      });
    },
    []
  );

  const addAgent = useCallback(
    async (agent: CustomAgentConfig) => {
      const next: OrchestratorGraphConfig = {
        ...config,
        agents: [...config.agents, agent],
        edges: config.edges.some((e) => e.source === "supervisor" && e.target === agent.id)
          ? config.edges
          : [...config.edges, { source: "supervisor", target: agent.id }],
      };
      await saveConfig(next);
    },
    [config, saveConfig]
  );

  const removeAgent = useCallback(
    async (agentId: string) => {
      if (agentId === "supervisor") return;
      const next: OrchestratorGraphConfig = {
        agents: config.agents.filter((a) => a.id !== agentId),
        edges: config.edges.filter((e) => e.source !== agentId && e.target !== agentId),
        supervisorModel: config.supervisorModel,
      };
      await saveConfig(next);
    },
    [config, saveConfig]
  );

  const withSyncedRoutes = useCallback(
    (next: OrchestratorGraphConfig): OrchestratorGraphConfig => {
      const agents = next.agents.map((agent) => ({
        ...agent,
        routesTo: [
          ...new Set(
            next.edges
              .filter((e) => e.source === agent.id)
              .map((e) => e.target)
              .filter((t) => t !== "supervisor" && t !== agent.id)
          ),
        ],
      }));
      return { ...next, agents };
    },
    []
  );

  const addEdge = useCallback(
    async (edge: GraphEdgeConfig) => {
      if (edge.source === edge.target) return;
      const exists = config.edges.some(
        (e) => e.source === edge.source && e.target === edge.target
      );
      if (exists) return;
      await saveConfig(
        withSyncedRoutes({ ...config, edges: [...config.edges, edge] })
      );
    },
    [config, saveConfig, withSyncedRoutes]
  );

  const removeEdge = useCallback(
    async (source: string, target: string) => {
      await saveConfig(
        withSyncedRoutes({
          ...config,
          edges: config.edges.filter((e) => !(e.source === source && e.target === target)),
        })
      );
    },
    [config, saveConfig, withSyncedRoutes]
  );

  const resetToDefault = useCallback(async () => {
    const res = await fetch(apiUrl("/api/orchestrator/reset"), { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const next = data.config as OrchestratorGraphConfig;
    setConfig(next);
    storeConfig(next);
  }, []);

  const agentIds = useMemo(
    () => ["supervisor", ...config.agents.map((a) => a.id)],
    [config.agents]
  );

  const value = useMemo(
    () => ({
      config,
      availableTools,
      availableModels,
      loading,
      saveConfig,
      applyRemoteConfig,
      updateAgentPosition,
      addAgent,
      removeAgent,
      addEdge,
      removeEdge,
      resetToDefault,
      agentIds,
    }),
    [
      config,
      availableTools,
      availableModels,
      loading,
      saveConfig,
      applyRemoteConfig,
      updateAgentPosition,
      addAgent,
      removeAgent,
      addEdge,
      removeEdge,
      resetToDefault,
      agentIds,
    ]
  );

  return (
    <OrchestratorContext.Provider value={value}>{children}</OrchestratorContext.Provider>
  );
}

export function useOrchestrator() {
  const ctx = useContext(OrchestratorContext);
  if (!ctx) throw new Error("useOrchestrator must be used within OrchestratorProvider");
  return ctx;
}

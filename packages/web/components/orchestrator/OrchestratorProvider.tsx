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
import { fetchChatSession, saveChatSessionGraph } from "../../app/api-client";
import { getAvailableModelOptions } from "../../lib/orchestrator-models";
import type {
  CustomAgentConfig,
  GraphEdgeConfig,
  OrchestratorGraphConfig,
  SkillDefinition,
} from "../../lib/types/orchestrator";

type OrchestratorContextValue = {
  config: OrchestratorGraphConfig;
  availableTools: string[];
  availableSkills: SkillDefinition[];
  availableModels: string[];
  loading: boolean;
  sessionId: string | null;
  saveConfig: (next: OrchestratorGraphConfig) => Promise<void>;
  applyRemoteConfig: (next: OrchestratorGraphConfig) => void;
  updateAgentPosition: (agentId: string, position: { x: number; y: number }) => void;
  updateAgent: (agentId: string, patch: Partial<CustomAgentConfig>) => Promise<void>;
  addAgent: (agent: CustomAgentConfig) => Promise<void>;
  removeAgent: (agentId: string) => Promise<void>;
  addEdge: (edge: GraphEdgeConfig) => Promise<void>;
  removeEdge: (source: string, target: string) => Promise<void>;
  resetToDefault: () => Promise<void>;
  agentIds: string[];
};

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

const BLANK_CONFIG: OrchestratorGraphConfig = { agents: [], edges: [] };

function isLegacyLoopingConfig(config: OrchestratorGraphConfig): boolean {
  const ids = new Set(config.agents.map((a) => a.id));
  return ids.has("coder") && ids.has("reviewer") && ids.has("pr_opener");
}

export function OrchestratorProvider({
  children,
  sessionId,
  initialConfig,
}: {
  children: ReactNode;
  sessionId: string | null;
  initialConfig?: OrchestratorGraphConfig | null;
}) {
  const [config, setConfig] = useState<OrchestratorGraphConfig>(
    initialConfig ?? BLANK_CONFIG
  );
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const availableModels = useMemo(() => getAvailableModelOptions(), []);

  useEffect(() => {
    if (!sessionId) {
      setConfig(initialConfig ?? BLANK_CONFIG);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const remote = await fetchChatSession(sessionId);
        if (cancelled) return;
        const next = remote.config ?? BLANK_CONFIG;
        setConfig(isLegacyLoopingConfig(next) ? BLANK_CONFIG : next);
        setAvailableTools(remote.available_tools ?? []);
        setAvailableSkills(remote.available_skills ?? []);
      } catch (err) {
        console.error("Failed to load session graph:", err);
        if (!cancelled && initialConfig) setConfig(initialConfig);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const saveConfig = useCallback(
    async (next: OrchestratorGraphConfig) => {
      if (!sessionId) {
        setConfig(next);
        return;
      }
      const saved = await saveChatSessionGraph(sessionId, next);
      setConfig(saved);
    },
    [sessionId]
  );

  const applyRemoteConfig = useCallback((next: OrchestratorGraphConfig) => {
    setConfig(next);
  }, []);

  const updateAgentPosition = useCallback(
    (agentId: string, position: { x: number; y: number }) => {
      setConfig((prev) => {
        const agents = prev.agents.map((a) =>
          a.id === agentId ? { ...a, position } : a
        );
        const next = { ...prev, agents };
        if (sessionId) void saveChatSessionGraph(sessionId, next);
        return next;
      });
    },
    [sessionId]
  );

  const updateAgent = useCallback(
    async (agentId: string, patch: Partial<CustomAgentConfig>) => {
      const next: OrchestratorGraphConfig = {
        ...config,
        agents: config.agents.map((a) => (a.id === agentId ? { ...a, ...patch, id: a.id } : a)),
      };
      await saveConfig(next);
    },
    [config, saveConfig]
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
        deliverableMode: config.deliverableMode,
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
      await saveConfig(withSyncedRoutes({ ...config, edges: [...config.edges, edge] }));
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
    await saveConfig(BLANK_CONFIG);
  }, [saveConfig]);

  const agentIds = useMemo(
    () => ["supervisor", ...config.agents.map((a) => a.id)],
    [config.agents]
  );

  const value = useMemo(
    () => ({
      config,
      availableTools,
      availableSkills,
      availableModels,
      loading,
      sessionId,
      saveConfig,
      applyRemoteConfig,
      updateAgentPosition,
      updateAgent,
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
      availableSkills,
      availableModels,
      loading,
      sessionId,
      saveConfig,
      applyRemoteConfig,
      updateAgentPosition,
      updateAgent,
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

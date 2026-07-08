export type CustomAgentConfig = {
  id: string;
  label: string;
  role: string;
  prompt?: string;
  tools: string[];
  model?: string;
  routesTo: string[];
  launchWhen?: string[];
  doNotLaunchWhen?: string[];
  position?: { x: number; y: number };
};

export type GraphEdgeConfig = {
  source: string;
  target: string;
  label?: string;
};

export type OrchestratorGraphConfig = {
  agents: CustomAgentConfig[];
  edges: GraphEdgeConfig[];
  supervisorModel?: string;
};

export type OrchestratorGraphResponse = {
  config: OrchestratorGraphConfig;
  schema: {
    nodes: { id: string; label: string }[];
    edges: GraphEdgeConfig[];
  };
  available_tools: string[];
  routing?: unknown;
};

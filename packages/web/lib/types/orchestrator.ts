export type CustomAgentConfig = {
  id: string;
  label: string;
  role: string;
  prompt?: string;
  tools: string[];
  skills?: string[];
  model?: string;
  routesTo: string[];
  launchWhen?: string[];
  doNotLaunchWhen?: string[];
  position?: { x: number; y: number };
};

export type SkillCategory =
  | "research"
  | "planning"
  | "development"
  | "quality"
  | "devops"
  | "communication";

export type SkillDefinition = {
  id: string;
  label: string;
  description: string;
  category: SkillCategory;
  tools: string[];
};

export type GraphEdgeConfig = {
  source: string;
  target: string;
  label?: string;
};

export type DeliverableMode =
  | { type: "chat" }
  | { type: "github"; pr?: boolean }
  | { type: "both"; pr?: boolean };

export type OrchestratorGraphConfig = {
  agents: CustomAgentConfig[];
  edges: GraphEdgeConfig[];
  supervisorModel?: string;
  deliverableMode?: DeliverableMode;
};

export type OrchestratorGraphResponse = {
  config: OrchestratorGraphConfig;
  schema: {
    nodes: { id: string; label: string }[];
    edges: GraphEdgeConfig[];
  };
  available_tools: string[];
  available_skills?: SkillDefinition[];
  routing?: unknown;
};

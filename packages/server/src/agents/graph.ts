import { supervisorGraph } from "./supervisor.js";
import { getCheckpointer, getStore } from "../db.js";
import {
  getCompiledGraphFromConfig,
  getGraphSchemaFromConfig,
  getSessionOrchestratorConfig,
  setSessionOrchestratorConfig,
} from "./dynamic-graph.js";
import type { OrchestratorGraphConfig } from "./agent-registry.js";

export { setSessionOrchestratorConfig, getSessionOrchestratorConfig, getGraphSchemaFromConfig };
export type { OrchestratorGraphConfig };

let defaultCompiledGraph: ReturnType<typeof supervisorGraph.compile> | null = null;

function getDefaultCompiledGraph() {
  if (!defaultCompiledGraph) {
    defaultCompiledGraph = supervisorGraph.compile({
      checkpointer: getCheckpointer(),
      store: getStore(),
    });
  }
  return defaultCompiledGraph;
}

export function getCompiledGraph(config?: OrchestratorGraphConfig, targetAgent?: string) {
  return getCompiledGraphFromConfig(config ?? getSessionOrchestratorConfig(), targetAgent);
}

export function invalidateCompiledGraph() {
  defaultCompiledGraph = null;
}

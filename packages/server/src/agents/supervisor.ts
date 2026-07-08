import { createSupervisor } from "@langchain/langgraph-supervisor";
import { getModel } from "../models-llm.js";
import { coderWorker, reviewerWorker, prWorker } from "./workers.js";
import { buildSupervisorPrompt } from "./routing-policy.js";

export const supervisorGraph = createSupervisor({
  agents: [coderWorker, reviewerWorker, prWorker],
  llm: getModel(),
  prompt: buildSupervisorPrompt(),
});

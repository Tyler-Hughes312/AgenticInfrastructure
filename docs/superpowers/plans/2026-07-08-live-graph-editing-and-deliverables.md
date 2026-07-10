# Live Graph Editing, On-the-fly Pipelines & Deliverables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace canned pipeline templates with always-LLM-designed graphs, add six live graph-edit operations (add/remove/connect/disconnect/rename/rebuild) that work from orchestrator chat, and route final deliverables to chat and/or GitHub based on what the prompt requests.

**Architecture:** Every orchestrator chat message is classified (regex fast-path → LLM fallback) into `graph_edit`, `task_run`, or `q_and_a`. Graph edits mutate the session config and refresh the canvas without running. Task runs always call `designGraphFromPrompt` which sets a `deliverableMode` field; after the pipeline streams, the run service synthesizes a final chat answer when mode is `chat` or `both`.

**Tech Stack:** TypeScript ESM, LangGraph, LangChain, Fastify, Vitest, React/Next.js

## Global Constraints

- ESM modules only — all imports use `.js` extension even for `.ts` source files
- `packages/server` uses Vitest for tests (`pnpm test` in that package)
- Never import `buildSoftwareDevPipeline` or `buildAgentTeamPipeline` in dispatch paths after Task 4
- `OrchestratorGraphConfig` type must stay in sync between `packages/server/src/agents/agent-registry.ts` and `packages/web/lib/types/orchestrator.ts`
- All graph state mutations call `syncRoutesToFromEdges` to keep `routesTo` arrays consistent with edges

---

### Task 1: Extend GraphEditCommand — add connect, disconnect, rename, rebuild

**Files:**
- Modify: `packages/server/src/agents/graph-edit.ts`
- Create: `packages/server/src/agents/graph-edit.test.ts`

**Interfaces:**
- Produces: `GraphEditCommand` union with six members; `applyGraphEdit` handles all six; `parseGraphEditCommand` parses all six from text

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/agents/graph-edit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseGraphEditCommand,
  applyGraphEdit,
} from "./graph-edit.js";
import type { OrchestratorGraphConfig } from "./agent-registry.js";

const baseConfig: OrchestratorGraphConfig = {
  agents: [
    { id: "researcher", label: "Researcher", role: "research", tools: ["shell"], routesTo: [] },
    { id: "writer", label: "Writer", role: "write", tools: ["shell"], routesTo: [] },
  ],
  edges: [{ source: "supervisor", target: "researcher", label: "start" }],
};

describe("parseGraphEditCommand - connect", () => {
  it("parses 'connect researcher → writer'", () => {
    expect(parseGraphEditCommand("connect researcher → writer")).toEqual({
      type: "connect",
      source: "researcher",
      target: "writer",
    });
  });
  it("parses 'wire researcher into writer'", () => {
    expect(parseGraphEditCommand("wire researcher into writer")).toEqual({
      type: "connect",
      source: "researcher",
      target: "writer",
    });
  });
  it("parses '/connect researcher writer'", () => {
    expect(parseGraphEditCommand("/connect researcher writer")).toEqual({
      type: "connect",
      source: "researcher",
      target: "writer",
    });
  });
});

describe("parseGraphEditCommand - disconnect", () => {
  it("parses 'disconnect supervisor from researcher'", () => {
    expect(parseGraphEditCommand("disconnect supervisor from researcher")).toEqual({
      type: "disconnect",
      source: "supervisor",
      target: "researcher",
    });
  });
  it("parses 'unlink researcher → writer'", () => {
    expect(parseGraphEditCommand("unlink researcher → writer")).toEqual({
      type: "disconnect",
      source: "researcher",
      target: "writer",
    });
  });
});

describe("parseGraphEditCommand - rename", () => {
  it("parses 'rename researcher to Scout'", () => {
    expect(parseGraphEditCommand("rename researcher to Scout")).toEqual({
      type: "rename",
      agentRef: "researcher",
      newLabel: "Scout",
    });
  });
  it("parses 'call writer Scribe'", () => {
    expect(parseGraphEditCommand("call writer Scribe")).toEqual({
      type: "rename",
      agentRef: "writer",
      newLabel: "Scribe",
    });
  });
});

describe("parseGraphEditCommand - rebuild", () => {
  it("parses 'rebuild graph for a 3-stage essay'", () => {
    expect(parseGraphEditCommand("rebuild graph for a 3-stage essay")).toEqual({
      type: "rebuild",
      task: "a 3-stage essay",
    });
  });
  it("parses '/rebuild write me a report'", () => {
    expect(parseGraphEditCommand("/rebuild write me a report")).toEqual({
      type: "rebuild",
      task: "write me a report",
    });
  });
});

describe("applyGraphEdit - connect", () => {
  it("adds an edge between two agents", () => {
    const { config, message } = applyGraphEdit(baseConfig, {
      type: "connect",
      source: "researcher",
      target: "writer",
    });
    expect(config.edges.some(e => e.source === "researcher" && e.target === "writer")).toBe(true);
    expect(message).toContain("researcher");
    expect(message).toContain("writer");
  });

  it("allows supervisor as source", () => {
    const { config } = applyGraphEdit(baseConfig, {
      type: "connect",
      source: "supervisor",
      target: "writer",
    });
    expect(config.edges.some(e => e.source === "supervisor" && e.target === "writer")).toBe(true);
  });

  it("returns error message for unknown agent", () => {
    const { config: unchanged, message } = applyGraphEdit(baseConfig, {
      type: "connect",
      source: "nobody",
      target: "writer",
    });
    expect(unchanged).toEqual(baseConfig);
    expect(message).toContain("Could not resolve");
  });
});

describe("applyGraphEdit - disconnect", () => {
  it("removes a matching edge", () => {
    const { config } = applyGraphEdit(baseConfig, {
      type: "disconnect",
      source: "supervisor",
      target: "researcher",
    });
    expect(config.edges.some(e => e.source === "supervisor" && e.target === "researcher")).toBe(false);
  });
});

describe("applyGraphEdit - rename", () => {
  it("updates the agent label", () => {
    const { config, message } = applyGraphEdit(baseConfig, {
      type: "rename",
      agentRef: "researcher",
      newLabel: "Scout",
    });
    const agent = config.agents.find(a => a.id === "researcher");
    expect(agent?.label).toBe("Scout");
    expect(message).toContain("Scout");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/server && pnpm test graph-edit
```

Expected: many failures like "type 'connect' not assignable" and "undefined is not an object"

- [ ] **Step 3: Extend `GraphEditCommand` union in `packages/server/src/agents/graph-edit.ts`**

Replace the existing `GraphEditCommand` type:

```ts
export type GraphEditCommand =
  | { type: "remove"; agentRef: string }
  | { type: "add"; label: string; role?: string; tools?: string[] }
  | { type: "connect"; source: string; target: string; label?: string }
  | { type: "disconnect"; source: string; target: string }
  | { type: "rename"; agentRef: string; newLabel: string }
  | { type: "rebuild"; task: string };
```

- [ ] **Step 4: Add regex patterns for the four new commands inside `parseGraphEditCommand`**

Insert these cases after the existing `add` block, before `return null`:

```ts
  // connect A → B / wire A into B / connect A to B
  const connect =
    trimmed.match(
      /^(?:connect|wire|link)\s+(.+?)\s+(?:→|->|to|into)\s+(.+?)[.!?]*$/i
    ) ?? trimmed.match(/^\/connect\s+(\S+)\s+(\S+)$/i);
  if (connect) {
    return { type: "connect", source: connect[1].trim(), target: connect[2].trim() };
  }

  // disconnect A → B / unlink A from B
  const disconnect =
    trimmed.match(
      /^(?:disconnect|unlink|remove\s+edge)\s+(.+?)\s+(?:→|->|from)\s+(.+?)[.!?]*$/i
    ) ?? trimmed.match(/^\/disconnect\s+(\S+)\s+(\S+)$/i);
  if (disconnect) {
    return { type: "disconnect", source: disconnect[1].trim(), target: disconnect[2].trim() };
  }

  // rename X to Y / call X Y / relabel X as Y
  const rename =
    trimmed.match(
      /^(?:rename|relabel)\s+(?:the\s+)?(.+?)\s+(?:to|as)\s+["']?(.+?)["']?[.!?]*$/i
    ) ?? trimmed.match(
      /^call\s+(?:the\s+)?(.+?)\s+["']?(.+?)["']?(?:\s+instead)?[.!?]*$/i
    ) ?? trimmed.match(/^\/rename\s+(\S+)\s+(\S+)$/i);
  if (rename) {
    return { type: "rename", agentRef: rename[1].trim(), newLabel: rename[2].trim() };
  }

  // rebuild graph for <task> / redesign pipeline for <task>
  const rebuild =
    trimmed.match(
      /^(?:rebuild|redesign|recreate|replace)\s+(?:the\s+)?(?:graph|pipeline|team|agents?)\s+(?:for\s+)?(.+)[.!?]*$/i
    ) ?? trimmed.match(/^\/rebuild\s+(.+)$/i);
  if (rebuild) {
    return { type: "rebuild", task: rebuild[1].trim() };
  }
```

- [ ] **Step 5: Add `connect`, `disconnect`, `rename` cases to `applyGraphEdit`**

Insert these cases inside `applyGraphEdit` before the existing `// add` comment. Note: `rebuild` is NOT handled here — run-service handles it specially because it requires an async LLM call.

```ts
  if (command.type === "connect") {
    const srcIsSuper = /^supervisor$/i.test(command.source.trim());
    const source = srcIsSuper
      ? { id: "supervisor", label: "supervisor" }
      : resolveAgentRef(command.source, config.agents);
    const target = resolveAgentRef(command.target, config.agents);
    if (!source || !target) {
      const known = config.agents.map((a) => `${a.label} (${a.id})`).join(", ") || "(none)";
      return {
        config,
        message: `Could not resolve agents for connect: "${command.source}" → "${command.target}". Known: ${known}.`,
      };
    }
    const alreadyExists = config.edges.some(
      (e) => e.source === source.id && e.target === target.id
    );
    if (alreadyExists) {
      return { config, message: `Edge **${source.id}** → **${target.id}** already exists.` };
    }
    const edges = [
      ...config.edges,
      { source: source.id, target: target.id, label: command.label ?? "→" },
    ];
    const next: OrchestratorGraphConfig = {
      agents: syncRoutesToFromEdges(config.agents, edges),
      edges,
      supervisorModel: config.supervisorModel,
    };
    return { config: next, message: `Connected **${source.id}** → **${target.id}**.` };
  }

  if (command.type === "disconnect") {
    const srcIsSuper = /^supervisor$/i.test(command.source.trim());
    const source = srcIsSuper
      ? { id: "supervisor", label: "supervisor" }
      : resolveAgentRef(command.source, config.agents);
    const target = resolveAgentRef(command.target, config.agents);
    if (!source || !target) {
      return {
        config,
        message: `Could not resolve agents for disconnect: "${command.source}" → "${command.target}".`,
      };
    }
    const edges = config.edges.filter(
      (e) => !(e.source === source.id && e.target === target.id)
    );
    const next: OrchestratorGraphConfig = {
      agents: syncRoutesToFromEdges(config.agents, edges),
      edges,
      supervisorModel: config.supervisorModel,
    };
    return { config: next, message: `Disconnected **${source.id}** → **${target.id}**.` };
  }

  if (command.type === "rename") {
    const agent = resolveAgentRef(command.agentRef, config.agents);
    if (!agent) {
      const known = config.agents.map((a) => a.label).join(", ") || "(none)";
      return {
        config,
        message: `Could not find agent "${command.agentRef}" to rename. Known: ${known}.`,
      };
    }
    const agents = config.agents.map((a) =>
      a.id === agent.id ? { ...a, label: command.newLabel } : a
    );
    const next: OrchestratorGraphConfig = { ...config, agents };
    return { config: next, message: `Renamed **${agent.label}** → **${command.newLabel}**.` };
  }

  if (command.type === "rebuild") {
    // rebuild is async — callers must handle this type specially (see run-service.ts)
    return { config, message: `Rebuild triggered for: "${command.task}"` };
  }
```

Note: `OrchestratorGraphConfig` is already imported at the top of `graph-edit.ts`. Add it to the import if it isn't there:
```ts
import type { CustomAgentConfig, GraphEdgeConfig, OrchestratorGraphConfig } from "./agent-registry.js";
```

- [ ] **Step 6: Run tests and confirm they pass**

```bash
cd packages/server && pnpm test graph-edit
```

Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
cd packages/server
git add src/agents/graph-edit.ts src/agents/graph-edit.test.ts
git commit -m "feat: add connect/disconnect/rename/rebuild to GraphEditCommand"
```

---

### Task 2: Add DeliverableMode type + wire into design-graph-from-prompt

**Files:**
- Modify: `packages/server/src/agents/agent-registry.ts`
- Modify: `packages/server/src/agents/design-graph-from-prompt.ts`
- Modify: `packages/web/lib/types/orchestrator.ts`
- Modify: `packages/server/src/agents/graph-edit.test.ts` (add one smoke test)

**Interfaces:**
- Consumes: `OrchestratorGraphConfig` from Task 1
- Produces: `DeliverableMode` type; `OrchestratorGraphConfig.deliverableMode?: DeliverableMode`; `designGraphFromPrompt` returns config with `deliverableMode` set

- [ ] **Step 1: Write a failing test for deliverableMode presence**

Add to `packages/server/src/agents/graph-edit.test.ts` (a new `describe` block at the bottom):

```ts
import { describe, it, expect, vi } from "vitest";
// (add this import at the top of the file alongside existing ones)
// import { designGraphFromPrompt } from "./design-graph-from-prompt.js";
// We can't call the real LLM in unit tests — we verify the type structure only.
import type { OrchestratorGraphConfig, DeliverableMode } from "./agent-registry.js";

describe("DeliverableMode type", () => {
  it("OrchestratorGraphConfig accepts deliverableMode", () => {
    const mode: DeliverableMode = { type: "chat" };
    const cfg: OrchestratorGraphConfig = {
      agents: [],
      edges: [],
      deliverableMode: mode,
    };
    expect(cfg.deliverableMode?.type).toBe("chat");
  });

  it("deliverableMode can be github with pr", () => {
    const mode: DeliverableMode = { type: "github", pr: true };
    const cfg: OrchestratorGraphConfig = { agents: [], edges: [], deliverableMode: mode };
    expect(cfg.deliverableMode?.type).toBe("github");
  });
});
```

- [ ] **Step 2: Run to confirm TypeScript fails (DeliverableMode not yet exported)**

```bash
cd packages/server && pnpm test graph-edit
```

Expected: compile error "Module has no exported member 'DeliverableMode'"

- [ ] **Step 3: Add `DeliverableMode` and update `OrchestratorGraphConfig` in `packages/server/src/agents/agent-registry.ts`**

Add after the `GraphEdgeConfig` type (around line 54):

```ts
export type DeliverableMode =
  | { type: "chat" }
  | { type: "github"; pr?: boolean }
  | { type: "both"; pr?: boolean };
```

Add `deliverableMode` field to `OrchestratorGraphConfig`:

```ts
export type OrchestratorGraphConfig = {
  agents: CustomAgentConfig[];
  edges: GraphEdgeConfig[];
  supervisorModel?: string;
  deliverableMode?: DeliverableMode;
};
```

Also update `normalizeOrchestratorConfig` to pass `deliverableMode` through:

```ts
export function normalizeOrchestratorConfig(
  input?: Partial<OrchestratorGraphConfig> | null
): OrchestratorGraphConfig {
  if (!input) return getDefaultOrchestratorConfig();
  const agents = input.agents ?? [];
  const edges = input.edges ?? [];
  if (!agents.length) {
    return { agents: [], edges: [], supervisorModel: input.supervisorModel, deliverableMode: input.deliverableMode };
  }
  return {
    agents: syncRoutesToFromEdges(agents, edges),
    edges,
    supervisorModel: input.supervisorModel,
    deliverableMode: input.deliverableMode,
  };
}
```

- [ ] **Step 4: Add `deliverable_mode` to the Zod schema in `packages/server/src/agents/design-graph-from-prompt.ts`**

Add the schema after the existing `designedEdgeSchema`:

```ts
const deliverableModeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat") }),
  z.object({ type: z.literal("github"), pr: z.boolean().optional() }),
  z.object({ type: z.literal("both"), pr: z.boolean().optional() }),
]);
```

Add `deliverable_mode` field to `designedGraphSchema`:

```ts
const designedGraphSchema = z.object({
  summary: z.string().min(1).max(500),
  final_deliverable: z
    .string()
    .min(1)
    .max(240)
    .describe("What the user should receive in chat when the pipeline finishes"),
  deliverable_mode: deliverableModeSchema.default({ type: "chat" }),
  agents: z.array(designedAgentSchema).min(1).max(10),
  edges: z.array(designedEdgeSchema).min(1).max(40),
  entry_agents: z.array(z.string()).min(1),
});
```

Update `toOrchestratorConfig` to include `deliverableMode`:

```ts
function toOrchestratorConfig(
  designed: z.infer<typeof designedGraphSchema>
): OrchestratorGraphConfig {
  // ... existing agent/edge building code unchanged ...
  return normalizeOrchestratorConfig({
    agents: syncRoutesToFromEdges(agents, edges),
    edges,
    deliverableMode: designed.deliverable_mode,
  });
}
```

Update the `SYSTEM` prompt constant to instruct the LLM to include `deliverable_mode`. Find the `SYSTEM` string and add to the JSON schema section:

```ts
const SYSTEM = `You design multi-agent orchestration graphs dynamically from the user's prompt.
Do NOT use canned pipelines. Invent agents/skills/tools/edges that fit THIS request.

Return ONLY JSON:
{
  "summary": string,
  "final_deliverable": string,
  "deliverable_mode": { "type": "chat" } | { "type": "github", "pr": true|false } | { "type": "both", "pr": true|false },
  "agents": [{ ... }],
  "edges": [{ ... }],
  "entry_agents": string[]
}

Rules:
- deliverable_mode: "chat" if the user wants an answer/essay/report in chat.
  "github" if they want code committed and pushed (pr:true if PR requested).
  "both" if they want a GitHub push AND a chat summary.
- 2–8 agents max (1 is OK for tiny tasks).
...rest of existing rules unchanged...`;
```

- [ ] **Step 5: Mirror `DeliverableMode` in web types at `packages/web/lib/types/orchestrator.ts`**

Add after the `GraphEdgeConfig` type:

```ts
export type DeliverableMode =
  | { type: "chat" }
  | { type: "github"; pr?: boolean }
  | { type: "both"; pr?: boolean };
```

Add `deliverableMode` to `OrchestratorGraphConfig`:

```ts
export type OrchestratorGraphConfig = {
  agents: CustomAgentConfig[];
  edges: GraphEdgeConfig[];
  supervisorModel?: string;
  deliverableMode?: DeliverableMode;
};
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd packages/server && pnpm test graph-edit
```

Expected: all tests PASS including the new DeliverableMode tests

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/agents/agent-registry.ts \
        packages/server/src/agents/design-graph-from-prompt.ts \
        packages/server/src/agents/graph-edit.test.ts \
        packages/web/lib/types/orchestrator.ts
git commit -m "feat: add DeliverableMode type and wire into design-graph-from-prompt schema"
```

---

### Task 3: Message classifier — classifyMessageIntent

**Files:**
- Create: `packages/server/src/agents/message-classifier.ts`
- Create: `packages/server/src/agents/message-classifier.test.ts`

**Interfaces:**
- Consumes: `parseGraphEditCommand` from `graph-edit.ts`; `getModel` from `models-llm.ts`
- Produces:
  ```ts
  export type MessageIntent =
    | { kind: "graph_edit"; command: GraphEditCommand }
    | { kind: "graph_edit_pending"; description: string; command: GraphEditCommand | null; confidence: number }
    | { kind: "task_run" }
    | { kind: "q_and_a" };

  export async function classifyMessageIntent(
    text: string,
    agents: CustomAgentConfig[]
  ): Promise<MessageIntent>
  ```

- [ ] **Step 1: Write the test**

Create `packages/server/src/agents/message-classifier.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { classifyMessageIntent } from "./message-classifier.js";
import type { CustomAgentConfig } from "./agent-registry.js";

const agents: CustomAgentConfig[] = [
  { id: "researcher", label: "Researcher", role: "research", tools: ["shell"], routesTo: [] },
];

describe("classifyMessageIntent - regex fast-path (no LLM needed)", () => {
  it("returns graph_edit for 'add security agent'", async () => {
    const result = await classifyMessageIntent("add security agent", agents);
    expect(result.kind).toBe("graph_edit");
  });

  it("returns graph_edit for 'remove researcher'", async () => {
    const result = await classifyMessageIntent("remove researcher", agents);
    expect(result.kind).toBe("graph_edit");
  });

  it("returns graph_edit for 'connect researcher → writer'", async () => {
    const result = await classifyMessageIntent("connect researcher → writer", agents);
    expect(result.kind).toBe("graph_edit");
  });

  it("returns graph_edit for 'rename researcher to Scout'", async () => {
    const result = await classifyMessageIntent("rename researcher to Scout", agents);
    expect(result.kind).toBe("graph_edit");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/server && pnpm test message-classifier
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `packages/server/src/agents/message-classifier.ts`**

```ts
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getModel } from "../models-llm.js";
import { parseGraphEditCommand, type GraphEditCommand } from "./graph-edit.js";
import type { CustomAgentConfig } from "./agent-registry.js";

export type MessageIntent =
  | { kind: "graph_edit"; command: GraphEditCommand }
  | { kind: "graph_edit_pending"; description: string; command: GraphEditCommand | null; confidence: number }
  | { kind: "task_run" }
  | { kind: "q_and_a" };

const CLASSIFIER_SYSTEM = `You classify orchestrator chat messages into one of three intents.
Return JSON only — no prose, no markdown fences:
{ "intent": "graph_edit" | "task_run" | "q_and_a", "confidence": <0.0-1.0>, "edit_description": "<string>" }

Definitions:
- graph_edit: structural canvas changes — add/remove/connect/disconnect/rename/rebuild agents or edges
- task_run: a task to execute with agents (coding, research, writing, analysis, build, etc.)
- q_and_a: a short question needing no work and no graph change

edit_description: plain English summary of the edit if intent is graph_edit, e.g.
  "connect researcher → essay_writer and remove publisher"
  Leave empty string for task_run and q_and_a.`;

export async function classifyMessageIntent(
  text: string,
  agents: CustomAgentConfig[]
): Promise<MessageIntent> {
  // Regex fast-path: high-confidence structural commands never need the LLM.
  const cmd = parseGraphEditCommand(text);
  if (cmd) return { kind: "graph_edit", command: cmd };

  // LLM fallback for natural-language edits and ambiguous messages.
  const agentList =
    agents.map((a) => `${a.id} (${a.label})`).join(", ") || "none";
  const model = getModel(false);

  try {
    const reply = await model.invoke([
      new SystemMessage(CLASSIFIER_SYSTEM),
      new HumanMessage(
        `Current graph agents: ${agentList}\n\nMessage: """${text}"""`
      ),
    ]);
    const raw =
      typeof reply.content === "string"
        ? reply.content
        : Array.isArray(reply.content)
          ? reply.content
              .map((c) =>
                typeof c === "string" ? c : (c as { text?: string }).text ?? ""
              )
              .join("")
          : String(reply.content ?? "");

    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return { kind: "task_run" };

    const json = JSON.parse(jsonMatch[0]) as {
      intent?: string;
      confidence?: number;
      edit_description?: string;
    };
    const intent = json.intent ?? "task_run";
    const confidence = typeof json.confidence === "number" ? json.confidence : 0.5;
    const desc = json.edit_description ?? "";

    if (intent === "q_and_a") return { kind: "q_and_a" };

    if (intent === "graph_edit") {
      if (confidence >= 0.8) {
        // High-confidence NL edit: treat as confirmed (command is null — run-service
        // must emit the description and let the user confirm manually for complex NL).
        return { kind: "graph_edit_pending", description: desc, command: null, confidence };
      }
      return { kind: "graph_edit_pending", description: desc, command: null, confidence };
    }

    return { kind: "task_run" };
  } catch {
    // Network/parse error → safe fallback to treat as task_run.
    return { kind: "task_run" };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/server && pnpm test message-classifier
```

Expected: all four PASS (regex fast-path never calls the LLM mock)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/agents/message-classifier.ts \
        packages/server/src/agents/message-classifier.test.ts
git commit -m "feat: add message intent classifier with regex fast-path and LLM fallback"
```

---

### Task 4: Wire everything in run-service — intent dispatch, rebuild, pipeline synthesis

This is the largest task. It replaces `resolveRunGraphConfig` and wires classification, LLM graph design, pending confirmation state, pipeline note collection, and post-run synthesis.

**Files:**
- Modify: `packages/server/src/services/run-service.ts`

**Interfaces:**
- Consumes: `classifyMessageIntent` (Task 3); `designGraphFromPrompt`, `shouldDesignGraphForTask`, `synthesizeFinalChatAnswer` (existing in `design-graph-from-prompt.ts`); `applyGraphEdit`, `parseGraphEditCommand` (Tasks 1+existing); new `GraphEditCommand` union types; `DeliverableMode` (Task 2)
- Produces: no new exports — internal changes only

- [ ] **Step 1: Add imports at the top of `run-service.ts`**

Find the existing import block and add:

```ts
import { classifyMessageIntent } from "../agents/message-classifier.js";
import {
  designGraphFromPrompt,
  synthesizeFinalChatAnswer,
  repoHintFromTask,
} from "../agents/design-graph-from-prompt.js";
```

Remove the existing imports of `buildSoftwareDevPipeline`, `isBlankWorkerGraph`, `isLegacyLoopingConfig`, `isSoftwareDevTask` from `software-dev-pipeline.js` and `buildAgentTeamPipeline`, `isAgentTeamDesignTask` from `agent-team-pipeline.js` from the dispatch path (keep them importable but delete these lines).

- [ ] **Step 2: Add pending confirmation state map (module level, after the `activeRuns` map)**

Find the line `const activeRuns = new Map<string, AbortController>();` and add directly after:

```ts
/**
 * Stores pending NL graph-edit confirmations keyed by projectId.
 * Cleared on apply, cancel, or when a new task_run starts.
 */
const pendingGraphEdits = new Map<
  string,
  { description: string; command: GraphEditCommand | null }
>();
```

Also add this import at the top if not present:
```ts
import type { GraphEditCommand } from "../agents/graph-edit.js";
```

- [ ] **Step 3: Replace `resolveRunGraphConfig` with `resolveSessionConfig`**

Delete the entire `resolveRunGraphConfig` function (lines ~40-81 in the current file) and replace with:

```ts
function resolveSessionConfig(
  orchestratorConfig?: OrchestratorGraphConfig
): OrchestratorGraphConfig {
  const incoming = normalizeOrchestratorConfig(orchestratorConfig);
  const session = normalizeOrchestratorConfig(getSessionOrchestratorConfig());
  // Prefer an explicit non-blank incoming config; otherwise use session.
  const isBlank = (c: OrchestratorGraphConfig) => !c.agents.length;
  return !isBlank(incoming) ? incoming : session;
}
```

- [ ] **Step 4: Add `isConfirmation` helper near the top of `run-service.ts`**

```ts
function isConfirmation(text: string): boolean {
  return /^\s*(yes|y|confirm|do\s+it|apply|ok|okay|sure|go|proceed|lgtm)\s*[.!?]?\s*$/i.test(
    text
  );
}
```

- [ ] **Step 5: Add `emitChatMessage` helper**

This is used to emit a supervisor chat message without running the graph:

```ts
async function emitChatMessage(
  runId: string,
  content: string,
  stepIndex: number,
  onAgentLensEvent?: (event: Record<string, unknown>) => void | Promise<void>
): Promise<void> {
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
```

- [ ] **Step 6: Add `emitGraphUpdated` helper**

```ts
async function emitGraphUpdated(
  runId: string,
  config: OrchestratorGraphConfig,
  reason: string,
  stepIndex: number,
  onAgentLensEvent?: (event: Record<string, unknown>) => void | Promise<void>
): Promise<void> {
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
```

- [ ] **Step 7: Rewrite the graph-edit block in `executeRun`**

Find the block starting at:
```ts
    // Chat-driven graph edits: "remove coder 3", "add security agent", etc.
    const editCmd = parseGraphEditCommand(task);
```

Replace that entire block (through the `return;` that ends it, around lines 206-250) with:

```ts
    // --- Intent classification ---
    const intent = await classifyMessageIntent(task, graphConfig.agents);

    // Pending confirmation check: user said "yes" to a pending NL edit.
    const pending = pendingGraphEdits.get(projectId);
    if (pending && isConfirmation(task)) {
      pendingGraphEdits.delete(projectId);
      if (pending.command) {
        const edited = applyGraphEdit(graphConfig, pending.command);
        graphConfig = edited.config;
        setSessionOrchestratorConfig(graphConfig);
        clearCompiledGraphCache();
        await emitGraphUpdated(runId, graphConfig, "graph_edit_confirmed", 0, onAgentLensEvent);
        await emitChatMessage(runId, edited.message, 1, onAgentLensEvent);
      } else {
        await emitChatMessage(
          runId,
          `Cancelled — I wasn't sure what to change. Try a more specific command.`,
          0,
          onAgentLensEvent
        );
      }
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    // Graph edits (regex fast-path).
    if (intent.kind === "graph_edit") {
      const cmd = intent.command;

      // rebuild requires async LLM call — handle specially.
      if (cmd.type === "rebuild") {
        const repoHint = repoHintFromTask(cmd.task, repoUrl);
        const { config: freshConfig, summary } = await designGraphFromPrompt(cmd.task, repoHint);
        setSessionOrchestratorConfig(freshConfig);
        clearCompiledGraphCache();
        graphConfig = freshConfig;
        await emitGraphUpdated(runId, graphConfig, "graph_rebuild", 0, onAgentLensEvent);
        await emitChatMessage(runId, `Graph rebuilt: ${summary}`, 1, onAgentLensEvent);
        await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
        emit(runId, { type: "run_completed", status: "completed" });
        return;
      }

      const edited = applyGraphEdit(graphConfig, cmd);
      graphConfig = edited.config;
      setSessionOrchestratorConfig(graphConfig);
      clearCompiledGraphCache();
      await emitGraphUpdated(runId, graphConfig, `graph_edit_${cmd.type}`, 0, onAgentLensEvent);
      await emitChatMessage(runId, edited.message, 1, onAgentLensEvent);
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    // NL graph edit — ask for confirmation.
    if (intent.kind === "graph_edit_pending") {
      pendingGraphEdits.set(projectId, { description: intent.description, command: intent.command });
      const confirmMsg = `I'd ${intent.description}. Reply **yes** to apply or anything else to cancel.`;
      await emitChatMessage(runId, confirmMsg, 0, onAgentLensEvent);
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    // Q&A — answer directly, no workers.
    if (intent.kind === "q_and_a") {
      const model = getModel(false);
      const reply = await model.invoke([new HumanMessage(task)]);
      const content =
        typeof reply.content === "string"
          ? reply.content
          : Array.isArray(reply.content)
            ? reply.content
                .map((c) =>
                  typeof c === "string" ? c : (c as { text?: string }).text ?? ""
                )
                .join("")
            : String(reply.content ?? "");
      await emitChatMessage(runId, content, 0, onAgentLensEvent);
      await db.update(runs).set({ status: "completed", completedAt: new Date() }).where(eq(runs.id, runId));
      emit(runId, { type: "run_completed", status: "completed" });
      return;
    }

    // task_run — design fresh graph with LLM, then run it.
    pendingGraphEdits.delete(projectId); // clear any stale pending edit
    const repoHint = repoHintFromTask(task, repoUrl);
    const { config: designedConfig } = await designGraphFromPrompt(task, repoHint);
    graphConfig = designedConfig;
    setSessionOrchestratorConfig(graphConfig);
    clearCompiledGraphCache();
```

Then keep the existing graph sync emit block (already present, lines ~253-270) which emits `orchestrator_graph_updated`. Remove the old `resolveRunGraphConfig` call site.

- [ ] **Step 8: Collect `pipelineNotes` during the stream loop and synthesize post-run**

Find the existing stream loop:
```ts
      for await (const ev of graph.streamEvents(input, {
```

Just before this loop, add:
```ts
      const pipelineNotes: string[] = [];
```

Inside the loop, after `await onAgentLensEvent?.(agentLensEv);`, add:

```ts
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
```

After the `for await` loop ends (just before the `const langfuseTraceUrl = ...` line), add:

```ts
      // Post-run: synthesize final chat answer when deliverable mode includes chat.
      const dm = graphConfig.deliverableMode;
      if (dm?.type === "chat" || dm?.type === "both") {
        if (pipelineNotes.length > 0) {
          const finalAnswer = await synthesizeFinalChatAnswer(task, pipelineNotes.join("\n\n---\n\n"));
          await emitChatMessage(runId, finalAnswer, stepIndex + 1, onAgentLensEvent);
        }
      }
```

- [ ] **Step 9: Apply the same classification logic in `streamFollowUpToRun`**

Find the follow-up graph-edit block in `streamFollowUpToRun` (around line 474):
```ts
  // Graph edits as follow-ups (e.g. "remove coder 3") — update canvas and return.
  const followEdit = parseGraphEditCommand(task);
```

Replace that entire block with an equivalent classification dispatch that mirrors what `executeRun` now does. The pattern is identical — classification → pending confirmation check → graph_edit → graph_edit_pending → q_and_a → task_run. Because `streamFollowUpToRun` yields events instead of calling `onAgentLensEvent`, the helpers need slight adaptation: use `yield` instead of `await onAgentLensEvent?.()`.

Extract a shared helper `yieldGraphUpdated` and `yieldChatMessage` (inline arrow functions using `yield*`) or just inline the yield statements. Simpler to inline since the function is already a generator:

```ts
  // --- Pending confirmation ---
  const pending2 = pendingGraphEdits.get(run.projectId);
  if (pending2 && isConfirmation(task)) {
    pendingGraphEdits.delete(run.projectId);
    const base2 = normalizeOrchestratorConfig(
      orchestratorConfig ?? getSessionOrchestratorConfig()
    );
    if (pending2.command) {
      const edited2 = applyGraphEdit(base2, pending2.command);
      setSessionOrchestratorConfig(edited2.config);
      clearCompiledGraphCache();
      const schema2 = getGraphSchemaFromConfig(edited2.config);
      yield { run_id: runId, event: "orchestrator_graph_updated", name: "graph_edit", data: { config: edited2.config, schema: schema2, reason: "graph_edit_confirmed", deployed: true, agent_ids: edited2.config.agents.map((a: CustomAgentConfig) => a.id) }, ts: Date.now(), step_index: 0 };
      yield { run_id: runId, event: "on_chat_model_end", name: "supervisor", data: { output: { content: edited2.message } }, metadata: { langgraph_node: "supervisor" }, ts: Date.now(), step_index: 1 };
    } else {
      yield { run_id: runId, event: "on_chat_model_end", name: "supervisor", data: { output: { content: "Cancelled." } }, metadata: { langgraph_node: "supervisor" }, ts: Date.now(), step_index: 0 };
    }
    await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
    return;
  }

  // --- Intent classification ---
  const base = normalizeOrchestratorConfig(orchestratorConfig ?? getSessionOrchestratorConfig());
  const intent2 = await classifyMessageIntent(task, base.agents);

  if (intent2.kind === "graph_edit") {
    const cmd2 = intent2.command;
    if (cmd2.type === "rebuild") {
      const { config: fresh, summary } = await designGraphFromPrompt(cmd2.task, repoHintFromTask(cmd2.task, project.repoUrl));
      setSessionOrchestratorConfig(fresh);
      clearCompiledGraphCache();
      const schemaf = getGraphSchemaFromConfig(fresh);
      yield { run_id: runId, event: "orchestrator_graph_updated", name: "graph_rebuild", data: { config: fresh, schema: schemaf, reason: "graph_rebuild", deployed: true, agent_ids: fresh.agents.map((a: CustomAgentConfig) => a.id) }, ts: Date.now(), step_index: 0 };
      yield { run_id: runId, event: "on_chat_model_end", name: "supervisor", data: { output: { content: `Graph rebuilt: ${summary}` } }, metadata: { langgraph_node: "supervisor" }, ts: Date.now(), step_index: 1 };
      await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
      return;
    }
    const edited3 = applyGraphEdit(base, cmd2);
    setSessionOrchestratorConfig(edited3.config);
    clearCompiledGraphCache();
    const schema3 = getGraphSchemaFromConfig(edited3.config);
    yield { run_id: runId, event: "orchestrator_graph_updated", name: "graph_edit", data: { config: edited3.config, schema: schema3, reason: `graph_edit_${cmd2.type}`, deployed: true, agent_ids: edited3.config.agents.map((a: CustomAgentConfig) => a.id) }, ts: Date.now(), step_index: 0 };
    yield { run_id: runId, event: "on_chat_model_end", name: "supervisor", data: { output: { content: edited3.message } }, metadata: { langgraph_node: "supervisor" }, ts: Date.now(), step_index: 1 };
    await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
    return;
  }

  if (intent2.kind === "graph_edit_pending") {
    pendingGraphEdits.set(run.projectId, { description: intent2.description, command: intent2.command });
    const confirmMsg2 = `I'd ${intent2.description}. Reply **yes** to apply or anything else to cancel.`;
    yield { run_id: runId, event: "on_chat_model_end", name: "supervisor", data: { output: { content: confirmMsg2 } }, metadata: { langgraph_node: "supervisor" }, ts: Date.now(), step_index: 0 };
    await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
    return;
  }

  if (intent2.kind === "q_and_a") {
    const qModel = getModel(false);
    const qReply = await qModel.invoke([new HumanMessage(task)]);
    const qContent = typeof qReply.content === "string" ? qReply.content : String(qReply.content ?? "");
    yield { run_id: runId, event: "on_chat_model_end", name: "supervisor", data: { output: { content: qContent } }, metadata: { langgraph_node: "supervisor" }, ts: Date.now(), step_index: 0 };
    await db.update(runs).set({ status: "completed", error: null }).where(eq(runs.id, runId));
    return;
  }

  // task_run: design fresh graph and fall through to the existing run code below.
  pendingGraphEdits.delete(run.projectId);
  const { config: freshForRun } = await designGraphFromPrompt(task, repoHintFromTask(task, project.repoUrl));
  setSessionOrchestratorConfig(freshForRun);
  clearCompiledGraphCache();
  // existing code continues from here with the run loop...
```

Delete the old `const followEdit = parseGraphEditCommand(task);` block that used to handle this.

- [ ] **Step 10: Check TypeScript compiles**

```bash
cd packages/server && pnpm build 2>&1 | head -50
```

Expected: zero errors. Fix any type errors (likely around `CustomAgentConfig` import in the follow-up generator — add the import if missing).

- [ ] **Step 11: Commit**

```bash
git add packages/server/src/services/run-service.ts
git commit -m "feat: replace canned pipeline dispatch with LLM intent classifier + designGraphFromPrompt"
```

---

### Task 5: Web — mirror new edit commands + pending_confirmation UI

**Files:**
- Modify: `packages/web/lib/graph-edit.ts`
- Modify: `packages/web/components/ide/OrchestratorChat.tsx`

**Interfaces:**
- Consumes: new `GraphEditCommand` union (Task 1); `pending_confirmation` chat event from server (emitted as `on_chat_model_end` with content starting "I'd…. Reply **yes**")
- Produces: updated preview messages for connect/disconnect/rename/rebuild; inline confirm/cancel button in OrchestratorChat when a pending confirmation message is present

- [ ] **Step 1: Mirror new `GraphEditCommand` types in `packages/web/lib/graph-edit.ts`**

Replace the `GraphEditCommand` type:

```ts
export type GraphEditCommand =
  | { type: "remove"; agentRef: string }
  | { type: "add"; label: string; role?: string }
  | { type: "connect"; source: string; target: string; label?: string }
  | { type: "disconnect"; source: string; target: string }
  | { type: "rename"; agentRef: string; newLabel: string }
  | { type: "rebuild"; task: string };
```

Add the four new regex cases to `parseGraphEditCommand` — exact same code as the server-side Task 1 Step 4 patterns.

Extend `previewGraphEditMessage` to handle new types:

```ts
export function previewGraphEditMessage(
  config: OrchestratorGraphConfig,
  command: GraphEditCommand
): string {
  if (command.type === "remove") {
    const n = normalizeRef(command.agentRef);
    const agent = config.agents.find(
      (a) =>
        a.id === n ||
        normalizeRef(a.label) === n ||
        a.id.replace(/_/g, "") === n.replace(/_/g, "") ||
        normalizeRef(a.label).replace(/_/g, "") === n.replace(/_/g, "")
    );
    if (!agent) return `Looking for agent "${command.agentRef}" to remove…`;
    return `Removing ${agent.label} (${agent.id}) from the graph…`;
  }
  if (command.type === "add") {
    return `Adding agent "${command.label}" to the graph…`;
  }
  if (command.type === "connect") {
    return `Connecting ${command.source} → ${command.target}…`;
  }
  if (command.type === "disconnect") {
    return `Disconnecting ${command.source} → ${command.target}…`;
  }
  if (command.type === "rename") {
    return `Renaming "${command.agentRef}" to "${command.newLabel}"…`;
  }
  if (command.type === "rebuild") {
    return `Rebuilding graph for: "${command.task}"…`;
  }
  return "Updating graph…";
}
```

- [ ] **Step 2: Update the empty placeholder hint in `OrchestratorChat.tsx`**

Find the line:
```tsx
              <code className="text-charcoal-muted">add security agent</code>.
```

Replace the surrounding hint paragraph with:

```tsx
<p className="text-xs text-charcoal-muted/70 break-words">
  Describe a task, or edit the graph:{" "}
  <code className="text-charcoal-muted">add researcher</code>,{" "}
  <code className="text-charcoal-muted">connect researcher → writer</code>,{" "}
  <code className="text-charcoal-muted">remove publisher</code>,{" "}
  <code className="text-charcoal-muted">rebuild graph for a 3-stage essay</code>.
  {agentIds.length > 1 && (
    <>
      {" "}
      Agents: {agentIds.filter((id) => id !== "supervisor").join(", ")}.
    </>
  )}
</p>
```

- [ ] **Step 3: Add `pendingConfirmation` state to `OrchestratorChat.tsx`**

Inside the component, add state alongside the existing state declarations:

```tsx
const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null);
```

- [ ] **Step 4: Detect confirmation prompts from incoming messages**

The server emits the confirmation prompt as an `on_chat_model_end` supervisor message whose content starts with "I'd " and ends with "Reply **yes**". The `useOrchestratorChat` hook drives `messages` via `onMessagesChange`. We need to watch for this pattern.

Add a `useEffect` that watches `messages` for the confirmation pattern:

```tsx
useEffect(() => {
  const last = messages[messages.length - 1];
  if (
    last?.role === "assistant" &&
    last.content.includes("Reply **yes**")
  ) {
    setPendingConfirmation(last.content);
  } else {
    setPendingConfirmation(null);
  }
}, [messages]);
```

- [ ] **Step 5: Add confirm/cancel buttons in the chat footer**

Find the `{showApprove && (` block. Add a sibling block directly below it:

```tsx
        {pendingConfirmation && !isRunning && (
          <div className="rounded-lg border border-charcoal-accent/40 bg-charcoal-accent/10 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-charcoal-muted">
              Confirm graph edit?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingConfirmation(null);
                  sendText("yes");
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:brightness-110"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingConfirmation(null);
                  sendText("cancel");
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-charcoal-raised text-charcoal-muted hover:bg-charcoal-border"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
```

- [ ] **Step 6: Verify TypeScript in the web package**

```bash
cd packages/web && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: zero errors. Fix any `GraphEditCommand` exhaustiveness errors in `previewGraphEditMessage`.

- [ ] **Step 7: Commit**

```bash
git add packages/web/lib/graph-edit.ts \
        packages/web/components/ide/OrchestratorChat.tsx
git commit -m "feat: mirror new graph-edit commands in web and add pending confirmation UI"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| Edit graph from chat: add/remove | Task 1 (new commands) + Task 4 (dispatch) |
| Edit graph from chat: connect/disconnect | Task 1 |
| Edit graph from chat: rename | Task 1 |
| Rebuild graph for new task | Task 1 + Task 4 (`rebuild` async path) |
| Natural language edits + confirmation | Task 3 (classifier) + Task 4 (pending state) + Task 5 (UI buttons) |
| No canned pipeline templates | Task 4 (removes `resolveRunGraphConfig` canned dispatch) |
| Always LLM-designed graphs for task_run | Task 4 (`designGraphFromPrompt` always called) |
| Deliverable mode set at design time | Task 2 (schema + type) + Task 4 (LLM prompt updated) |
| Return result to chat | Task 4 (post-run synthesis with `synthesizeFinalChatAnswer`) |
| Push to GitHub | Existing `open_pull_request` tool; Task 2 wires `deliverable_mode: github` so LLM assigns PR tools |
| Pending confirmation in-memory store | Task 4 (`pendingGraphEdits` map keyed by `projectId`) |
| Canvas refreshes on every edit | Tasks 1+4 (every edit path emits `orchestrator_graph_updated`) |

**No gaps found.**

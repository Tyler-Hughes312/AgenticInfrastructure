# Live Graph Editing, On-the-fly Pipelines & Deliverables to Chat/GitHub

**Date:** 2026-07-08
**Status:** Approved

## Goals

1. Edit the live graph from orchestrator chat — add/remove agents, connect/disconnect edges, rename agents, rebuild the whole graph — with no page reload.
2. Remove all canned pipeline templates from the dispatch path. Every task run designs a fresh graph via LLM.
3. Pipelines return results to chat (essays, reports, answers) and/or push to GitHub, configured per-run at design time.

---

## Architecture

Every orchestrator chat message is classified before anything runs:

```
user message
     │
     ▼
┌─────────────────────────────────────┐
│         Message Classifier          │
│  1. regex fast-path                 │
│  2. LLM fallback (confidence score) │
└──────┬──────────┬────────┬──────────┘
       │          │        │
  graph_edit   task_run   q&a
       │          │        │
  GraphEditor  DesignGraph  DirectReply
  (no run)    FromPrompt   (LLM only)
               + run loop
```

**`graph_edit`** — structural changes only. Mutates session graph, emits `orchestrator_graph_updated`, does not start a run.

**`task_run`** — any prompt with work to do. Always calls `designGraphFromPrompt`; LLM invents agents, edges, and deliverable mode fresh for each prompt. No canned templates.

**`q&a`** — short questions with no graph or task intent. Supervisor LLM answers directly without deploying workers.

---

## Graph Edit Operations

Six operations, all applied via the server-side `applyGraphEdit` function and mirrored in the web `parseGraphEditCommand` for optimistic UI preview.

| Operation | Regex fast-path | Natural language example |
|---|---|---|
| `add` | `add researcher` | "add a researcher agent that searches the web" |
| `remove` | `remove reviewer` | "drop the publisher" |
| `connect` | `connect A → B` | "wire researcher into essay writer" |
| `disconnect` | `disconnect A → B` | "unlink reviewer from publisher" |
| `rename` | `rename builder to coder` | "call the builder 'coder' instead" |
| `rebuild` | `rebuild graph for <task>` | "redesign the pipeline for a 3-stage essay" |

### `connect` / `disconnect`

New operations not currently in `graph-edit.ts`. They add or remove entries from `config.edges` and call `syncRoutesToFromEdges` to keep `routesTo` arrays on each agent consistent.

```ts
| { type: "connect"; source: string; target: string; label?: string }
| { type: "disconnect"; source: string; target: string }
```

### `rename`

Updates `label` on a matched agent in-place. Does not change `id` (which is structural).

### `rebuild`

Calls `designGraphFromPrompt` with the new task description, replaces the entire session graph config, emits `orchestrator_graph_updated`. Does not start a run.

### Ambiguity handling

The LLM classifier returns a confidence score (0–1). If confidence < 0.8 on a natural-language edit, the server emits a `pending_confirmation` chat event describing the interpreted action — e.g. *"I'd connect researcher → essay_writer and remove publisher. Confirm?"* — and stores the pending command in session state. A follow-up "yes / confirm / do it" applies it; anything else cancels and clears the pending state.

---

## Task Run — LLM-Designed Graphs

### Always fresh

`resolveRunGraphConfig` is replaced. For every `task_run` message:

1. Call `designGraphFromPrompt(task, repoHint?)`.
2. Apply the returned `OrchestratorGraphConfig` as the session graph.
3. Emit `orchestrator_graph_updated` so the canvas refreshes.
4. Compile and run the graph.

`buildSoftwareDevPipeline` and `buildAgentTeamPipeline` are removed from the dispatch path (files kept for reference).

### Deliverable mode

`designGraphFromPrompt` gains a `deliverable_mode` field in its schema, set by the LLM at design time based on the prompt:

```ts
type DeliverableMode =
  | { type: "chat" }                          // post final answer to chat
  | { type: "github"; push: true; pr?: true } // commit + optional PR; URL in chat
  | { type: "both" }                          // push + chat summary
```

The designed config carries `deliverableMode` through to `OrchestratorGraphConfig`.

### Post-run synthesis

After the graph finishes streaming, the run service checks `deliverableMode`:

- **`chat` or `both`**: concatenate all agent final messages into `pipelineNotes`, call `synthesizeFinalChatAnswer(task, pipelineNotes)`, emit result as a supervisor `on_chat_model_end` event so it appears as a chat bubble.
- **`github` or `both`**: PR URL already surfaces via the existing `open_pull_request` tool event; no extra step needed.

`pipelineNotes` is collected during the stream loop by appending any `on_chat_model_end` message where `langgraph_node !== "supervisor"`.

---

## Deliverable Mode Examples

| Prompt | `deliverable_mode` | What user sees |
|---|---|---|
| "write me a 200-word essay on X" | `{ type: "chat" }` | Essay appears in chat |
| "build feature Y and open a PR" | `{ type: "github", push: true, pr: true }` | PR URL in chat |
| "research X and push findings to my repo" | `{ type: "both" }` | Push happens + summary in chat |
| "what is the capital of France?" | q&a (no run) | Direct LLM answer |

---

## File Changes

### Server — `packages/server/src/`

| File | Change |
|---|---|
| `agents/graph-edit.ts` | Add `connect`, `disconnect`, `rename`, `rebuild` to `GraphEditCommand` union; add LLM classifier path with confidence score; add `pending_confirmation` return type |
| `agents/design-graph-from-prompt.ts` | Add `deliverable_mode` to Zod schema; return `deliverableMode` on `OrchestratorGraphConfig`; export `DeliverableMode` type |
| `agents/agent-registry.ts` | Add optional `deliverableMode: DeliverableMode` to `OrchestratorGraphConfig` |
| `services/run-service.ts` | Replace `resolveRunGraphConfig` with intent-classifier + `designGraphFromPrompt`; collect `pipelineNotes` during stream; call `synthesizeFinalChatAnswer` post-run when appropriate; handle `pending_confirmation` state |
| `agents/software-dev-pipeline.ts` | Remove from dispatch path (keep file) |
| `agents/agent-team-pipeline.ts` | Remove from dispatch path (keep file) |

### Web — `packages/web/`

| File | Change |
|---|---|
| `lib/graph-edit.ts` | Mirror new `connect`, `disconnect`, `rename`, `rebuild` command types for optimistic UI preview |
| `components/ide/OrchestratorChat.tsx` | Handle `pending_confirmation` event — show inline confirm/cancel buttons in chat bubble; send confirmation message on confirm |

---

## Out of Scope

- Tool invention mid-run (agents inventing new tools dynamically during execution)
- Parallel entry-point execution differences in the UI
- Streaming partial essay chunks to chat (post-run synthesis is one shot)
- Persisting graph edits across browser sessions (session-scoped for now)

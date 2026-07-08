# Blank canvas + auto-deployed software-dev pipeline

**Date:** 2026-07-08  
**Status:** Approved

## Goals

1. Stop supervisor ↔ sub-agent recursion loops (LANGGRAPH recursion limit).
2. Start each project on a **blank canvas** (supervisor only).
3. Supervisor **automatically decides** which sub-agents to deploy for a prompt, deploys them onto the live graph, then runs them.
4. Default software-dev pipeline: `planner → builder → reviewer → publisher` (publisher targets configured GitHub repo / URL in prompt).

## Default graph

- Agents: none (empty list).
- Edges: none.
- Schema UI still shows a **supervisor** node so the canvas is not empty of meaning.
- “New chat” / reset returns to this blank state.

## Auto-deploy on prompt

When a run starts with no worker agents:

1. Classify task (coding/ship vs Q&A).
2. **Q&A:** do not deploy workers; supervisor/chat model answers and ends.
3. **Software / build:** deploy the software-dev pipeline onto the session graph (nodes + edges), emit `orchestrator_graph_updated` so the Graph tab refreshes, then run the compiled supervisor over those workers.
4. Anti-loop: each stage once; reviewer→builder at most once; then publisher or END. `recursionLimit` ≥ 80 on invoke.

## Agent roles

| id | Responsibility |
|----|----------------|
| planner | Scope, file plan, acceptance checks — no heavy coding |
| builder | Implement in workspace |
| reviewer | Diff review; at most one send-back |
| publisher | Commit + PR/push to repo from Settings or prompt |

## Out of scope

- Fully free-form LLM-invented tools mid-run
- Light mode / unrelated UI polish

"use client";

import { useMemo } from "react";
import type { RunEvent } from "../lib/types/run";

type Usage = {
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
};

function asUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, number>;
  return {
    total_tokens: o.total_tokens,
    prompt_tokens: o.input_tokens ?? o.prompt_tokens,
    completion_tokens: o.output_tokens ?? o.completion_tokens,
  };
}

function extractUsage(e: RunEvent): Usage | null {
  if (e.event === "on_chat_model_end") {
    const chunk = e.data?.chunk as Record<string, unknown> | undefined;
    const output = e.data?.output as Record<string, unknown> | undefined;
    return (
      asUsage(output?.usage_metadata) ||
      asUsage(chunk?.usage_metadata) ||
      asUsage(e.data?.usage_metadata) ||
      asUsage((chunk?.response_metadata as { token_usage?: unknown } | undefined)?.token_usage) ||
      asUsage((output?.response_metadata as { token_usage?: unknown } | undefined)?.token_usage) ||
      asUsage((e.data?.response_metadata as { token_usage?: unknown } | undefined)?.token_usage) ||
      asUsage(e.metadata?.token_usage)
    );
  }
  if (e.event === "on_chat_model_stream") {
    const chunk = e.data?.chunk as Record<string, unknown> | undefined;
    return (
      asUsage(chunk?.usage_metadata) ||
      asUsage((chunk?.response_metadata as { token_usage?: unknown } | undefined)?.token_usage)
    );
  }
  return null;
}

function tokenCount(usage: Usage | null): number {
  if (!usage) return 0;
  if (usage.total_tokens) return usage.total_tokens;
  if (usage.prompt_tokens && usage.completion_tokens) {
    return usage.prompt_tokens + usage.completion_tokens;
  }
  return 0;
}

function modelFromEvent(e: RunEvent): string {
  const meta = e.metadata as Record<string, unknown> | undefined;
  const data = e.data as
    | {
        output?: { response_metadata?: { model_name?: string; model?: string } };
        chunk?: { response_metadata?: { model_name?: string; model?: string } };
      }
    | undefined;
  return (
    (typeof meta?.ls_model_name === "string" && meta.ls_model_name) ||
    (typeof meta?.model === "string" && meta.model) ||
    data?.output?.response_metadata?.model_name ||
    data?.output?.response_metadata?.model ||
    data?.chunk?.response_metadata?.model_name ||
    data?.chunk?.response_metadata?.model ||
    "unknown"
  );
}

export default function CostLatencyPanel({
  events,
  agentIds = [],
}: {
  events: RunEvent[];
  agentIds?: string[];
}) {
  const stats = useMemo(() => {
    const startTs: Record<string, number> = {};
    const latencyMs: Record<string, number[]> = {};
    const byModel: Record<string, { tokens: number; calls: number }> = {};
    let totalTokens = 0;
    const nodeIds = new Set<string>(
      agentIds.length ? agentIds : ["supervisor", "coder", "reviewer", "pr_opener"]
    );

    for (const e of events) {
      if (!e.ts) continue;

      const nodeName = e.metadata?.langgraph_node || e.name;
      if (nodeName && nodeIds.has(nodeName)) {
        if (e.event === "on_chain_start" || e.event === "on_node_start") {
          startTs[nodeName] = e.ts;
        }
        if (e.event === "on_chain_end" || e.event === "on_node_end") {
          const st = startTs[nodeName];
          if (st) {
            const ms = (e.ts - st) * 1000;
            latencyMs[nodeName] = latencyMs[nodeName] || [];
            latencyMs[nodeName].push(ms);
          }
        }
      }

      if (e.event === "on_chat_model_end") {
        const tokens = tokenCount(extractUsage(e));
        if (tokens > 0) {
          totalTokens += tokens;
          const model = modelFromEvent(e);
          byModel[model] = byModel[model] || { tokens: 0, calls: 0 };
          byModel[model].tokens += tokens;
          byModel[model].calls += 1;
        }
      }
    }

    const avgLatency: Record<string, number> = {};
    for (const k of Object.keys(latencyMs)) {
      const arr = latencyMs[k];
      avgLatency[k] = arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    const estCostUsd = (totalTokens / 1_000_000) * 0.15;
    return { avgLatency, totalTokens, estCostUsd, byModel };
  }, [events, agentIds]);

  const modelRows = Object.entries(stats.byModel).sort((a, b) => b[1].tokens - a[1].tokens);

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs font-semibold text-charcoal-muted mb-2">By model</p>
        {modelRows.length === 0 ? (
          <p className="text-xs text-charcoal-muted">No LLM usage yet</p>
        ) : (
          <div className="space-y-1.5">
            {modelRows.map(([model, row]) => (
              <div key={model} className="flex justify-between gap-2 text-xs">
                <span className="font-mono truncate text-charcoal-text">{model}</span>
                <span className="text-charcoal-muted shrink-0">
                  {row.calls} calls · {row.tokens} tok
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-charcoal-border space-y-2">
        <p className="text-xs font-semibold text-charcoal-muted">By agent (latency)</p>
        {Object.entries(stats.avgLatency).map(([node, ms]) => (
          <div key={node} className="flex justify-between">
            <span>{node}</span>
            <span className="text-charcoal-muted">{ms.toFixed(0)} ms avg</span>
          </div>
        ))}
      </div>

      <div className="pt-2 border-t border-charcoal-border flex justify-between">
        <span>Total tokens</span>
        <span className="text-charcoal-muted">{stats.totalTokens}</span>
      </div>
      <div className="flex justify-between">
        <span>Est. cost</span>
        <span className="text-charcoal-muted">${stats.estCostUsd.toFixed(4)}</span>
      </div>
    </div>
  );
}

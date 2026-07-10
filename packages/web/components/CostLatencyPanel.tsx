"use client";

import { useMemo } from "react";
import type { RunEvent } from "../lib/types/run";

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

      let usage = null;

      if (e.event === "on_chat_model_end") {
        const chunk = e.data?.chunk;
        const output = e.data?.output;

        const usageMetadata =
          output?.usage_metadata ||
          chunk?.usage_metadata ||
          e.data?.usage_metadata;

        if (usageMetadata && typeof usageMetadata === "object") {
          usage = {
            total_tokens: usageMetadata.total_tokens,
            prompt_tokens: usageMetadata.input_tokens,
            completion_tokens: usageMetadata.output_tokens,
          };
        } else {
          usage =
            chunk?.response_metadata?.token_usage ||
            output?.response_metadata?.token_usage ||
            e.data?.response_metadata?.token_usage ||
            e.metadata?.token_usage;
        }
      } else if (e.event === "on_chat_model_stream") {
        const chunk = e.data?.chunk;
        const usageMetadata = chunk?.usage_metadata;
        if (usageMetadata && typeof usageMetadata === "object") {
          usage = {
            total_tokens: usageMetadata.total_tokens,
            prompt_tokens: usageMetadata.input_tokens,
            completion_tokens: usageMetadata.output_tokens,
          };
        } else {
          usage = chunk?.response_metadata?.token_usage;
        }
      } else if (e.event === "on_chain_end" && (e.name === "ChatOpenAI" || e.name?.includes("ChatOpenAI"))) {
        const usageMetadata =
          e.data?.output?.usage_metadata ||
          e.data?.usage_metadata;

        if (usageMetadata && typeof usageMetadata === "object") {
          usage = {
            total_tokens: usageMetadata.total_tokens,
            prompt_tokens: usageMetadata.input_tokens,
            completion_tokens: usageMetadata.output_tokens,
          };
        } else {
          usage =
            e.data?.output?.response_metadata?.token_usage ||
            e.data?.response_metadata?.token_usage ||
            e.metadata?.token_usage;
        }
      }

      if (usage) {
        if (usage.total_tokens) {
          totalTokens += usage.total_tokens;
        } else if (typeof usage === "number") {
          totalTokens += usage;
        } else if (usage.prompt_tokens && usage.completion_tokens) {
          totalTokens += usage.prompt_tokens + usage.completion_tokens;
        }
      }
    }

    const avgLatency: Record<string, number> = {};
    for (const k of Object.keys(latencyMs)) {
      const arr = latencyMs[k];
      avgLatency[k] = arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    const estCostUsd = (totalTokens / 1_000_000) * 0.15;

    return { avgLatency, totalTokens, estCostUsd };
  }, [events, agentIds]);

  return (
    <div className="space-y-2 text-sm">
      <div className="space-y-2 text-sm">
        {Object.entries(stats.avgLatency).map(([node, ms]) => (
          <div key={node} className="flex justify-between">
            <span>{node}</span>
            <span className="text-charcoal-muted">{ms.toFixed(0)} ms avg</span>
          </div>
        ))}

        <div className="pt-2 border-t border-charcoal-border flex justify-between">
          <span>Total tokens</span>
          <span className="text-charcoal-muted">{stats.totalTokens}</span>
        </div>

        <div className="flex justify-between">
          <span>Estimated cost</span>
          <span className="text-charcoal-muted">${stats.estCostUsd.toFixed(4)}</span>
        </div>
      </div>
    </div>
  );
}

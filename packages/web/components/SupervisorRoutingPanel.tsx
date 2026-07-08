"use client";

import { useEffect, useState } from "react";
import { fetchRoutingPolicy } from "../app/api-client";

type AgentRule = {
  id: string;
  label: string;
  role: string;
  launchWhen: string[];
  doNotLaunchWhen: string[];
  tools: string[];
  routesTo: string[];
};

type RoutingPolicy = {
  supervisor_rules: string[];
  agents: AgentRule[];
  default_flow: string[];
  retry_flow: string[];
};

export default function SupervisorRoutingPanel() {
  const [policy, setPolicy] = useState<RoutingPolicy | null>(null);

  useEffect(() => {
    fetchRoutingPolicy()
      .then(setPolicy)
      .catch((err) => console.error("Failed to load routing policy:", err));
  }, []);

  if (!policy) {
    return (
      <div className="text-sm text-charcoal-muted text-center py-4">Loading routing policy...</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {policy.default_flow.map((agent, i) => (
          <div key={agent} className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-charcoal-accent/15 text-charcoal-accent text-xs font-semibold capitalize">
              {agent}
            </span>
            {i < policy.default_flow.length - 1 && (
              <span className="text-charcoal-muted">→</span>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {policy.agents.map((agent) => (
          <details
            key={agent.id}
            className="rounded-xl border border-charcoal-border bg-charcoal-surface/50 overflow-hidden"
          >
            <summary className="px-4 py-3 cursor-pointer font-medium text-sm flex items-center justify-between text-charcoal-text">
              <span>
                <span className="text-blue-400 font-mono">{agent.id}</span>
                <span className="text-charcoal-muted ml-2">— {agent.role}</span>
              </span>
              <span className="text-xs text-charcoal-muted">
                → {agent.routesTo.length ? agent.routesTo.join(", ") : "END"}
              </span>
            </summary>
            <div className="px-4 pb-4 text-xs space-y-2 border-t border-charcoal-border pt-3">
              <div>
                <p className="font-semibold text-green-400 mb-1">Launch when</p>
                <ul className="list-disc list-inside text-charcoal-muted space-y-0.5">
                  {agent.launchWhen.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-semibold text-red-400 mb-1">Do not launch when</p>
                <ul className="list-disc list-inside text-charcoal-muted space-y-0.5">
                  {agent.doNotLaunchWhen.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>
              <p className="text-charcoal-muted">
                Tools: <span className="font-mono text-charcoal-muted">{agent.tools.join(", ")}</span>
              </p>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

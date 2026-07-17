"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeDragHandler } from "reactflow";
import type { RunEvent } from "../lib/types/run";
import type { AgentMeta } from "../lib/agent-debug";
import { computeAgentMetrics, extractToolCalls, getAgentNodeState } from "../lib/agent-debug";
import { useOrchestrator } from "./orchestrator/OrchestratorProvider";
import AgentCreateModal from "./orchestrator/AgentCreateModal";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Handle,
  Position,
  type NodeProps,
  type Connection,
} from "reactflow";
import dagre from "dagre";
import "reactflow/dist/style.css";

type AgentNodeData = {
  label: string;
  role?: string;
  model?: string;
  tools?: string[];
  status: "idle" | "running" | "done";
  toolCount: number;
  tokens: number;
  isActive: boolean;
  isNext: boolean;
  isDone: boolean;
  isSelected: boolean;
  editable: boolean;
};

const layoutNodes = (nodes: Node[], edges: Edge[]) => {
  const needsLayout = nodes.some((n) => n.position.x === 0 && n.position.y === 0);
  if (!needsLayout) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((n) => g.setNode(n.id, { width: 220, height: 110 }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - 110, y: pos.y - 55 },
    };
  });
};

function AgentFlowNode({ data }: NodeProps<AgentNodeData>) {
  const border = data.isSelected
    ? "border-charcoal-accent ring-2 ring-charcoal-accent/30"
    : data.isActive
      ? "border-charcoal-accent"
      : data.isDone
        ? "border-emerald-500/80"
        : data.isNext
          ? "border-charcoal-accent/50"
          : "border-charcoal-border";

  const bg = data.isActive
    ? "bg-charcoal-raised"
    : data.isDone
      ? "bg-emerald-950/30"
      : data.isNext
        ? "bg-charcoal-raised/80"
        : "bg-charcoal-surface";

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-charcoal-muted" />
      <div
        className={`w-[220px] rounded-xl border-2 px-3 py-2 shadow-sm transition-all text-charcoal-text ${border} ${bg} ${
          data.isActive ? "animate-pulse" : ""
        } ${data.editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm capitalize">{data.label}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${
              data.status === "running"
                ? "bg-charcoal-accent text-white"
                : data.status === "done"
                  ? "bg-emerald-600 text-white"
                  : "bg-charcoal-raised text-charcoal-muted"
            }`}
          >
            {data.status}
          </span>
        </div>
        {data.role && (
          <p className="text-[10px] text-charcoal-muted mt-1 line-clamp-2 leading-tight">{data.role}</p>
        )}
        {data.model && (
          <p className="text-[9px] font-mono text-charcoal-accent/90 mt-1 truncate">{data.model}</p>
        )}
        <div className="flex items-center gap-2 mt-2 text-[10px] text-charcoal-muted">
          <span>{data.toolCount} tools</span>
          <span>·</span>
          <span>{data.tokens} tok</span>
        </div>
        {data.tools && data.tools.length > 0 && (
          <p className="text-[9px] font-mono text-charcoal-muted mt-1 truncate">
            {data.tools.slice(0, 3).join(", ")}
            {data.tools.length > 3 ? "…" : ""}
          </p>
        )}
        {data.isSelected && !data.editable && (
          <p className="text-[10px] text-blue-400 mt-1 font-medium">Click to debug →</p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-charcoal-muted" />
    </>
  );
}

const nodeTypes = { agentNode: AgentFlowNode };

type GraphViewerProps = {
  events: RunEvent[];
  agentMetaMap?: Record<string, AgentMeta>;
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string | null) => void;
  editable?: boolean;
};

export default function GraphViewer({
  events,
  agentMetaMap = {},
  selectedNodeId = null,
  onNodeSelect,
  editable = true,
}: GraphViewerProps) {
  const {
    config,
    availableTools,
    availableSkills,
    availableModels,
    saveConfig,
    addAgent,
    removeAgent,
    addEdge,
    agentIds,
  } = useOrchestrator();

  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [completedNodes, setCompletedNodes] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [supervisorPosition, setSupervisorPosition] = useState({ x: 300, y: 20 });
  const dragPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schemaNodes = useMemo(() => {
    const workers = config.agents.filter((a) => a.id !== "supervisor");
    return [
      { id: "supervisor", label: "Supervisor" },
      ...workers.map((a) => ({ id: a.id, label: a.label })),
    ];
  }, [config.agents]);

  const schemaEdges = config.edges;
  const NODE_IDS = useMemo(() => new Set(schemaNodes.map((n) => n.id)), [schemaNodes]);
  const workerIds = useMemo(() => config.agents.map((a) => a.id), [config.agents]);

  useEffect(() => {
    if (!schemaNodes.length) return;

    if (!events.length) {
      setActiveNode(null);
      setCompletedNodes(new Set());
      return;
    }

    const activeNodes = new Set<string>();
    const completedNodesSet = new Set<string>();
    let mostRecentActive: string | null = null;
    const nodeStartTimes = new Map<string, number>();

    for (const e of events) {
      const nodeName = e.metadata?.langgraph_node || e.name;
      if (!nodeName || !NODE_IDS.has(nodeName)) continue;

      if (e.event === "on_chain_start" || e.event === "on_node_start") {
        activeNodes.add(nodeName);
        nodeStartTimes.set(nodeName, e.ts || 0);
        if (
          !mostRecentActive ||
          (nodeStartTimes.get(nodeName) || 0) > (nodeStartTimes.get(mostRecentActive) || 0)
        ) {
          mostRecentActive = nodeName;
        }
      }

      if (e.event === "on_chain_end" || e.event === "on_node_end") {
        activeNodes.delete(nodeName);
        completedNodesSet.add(nodeName);
        nodeStartTimes.delete(nodeName);
        if (mostRecentActive === nodeName) {
          mostRecentActive = null;
          for (const [node, time] of nodeStartTimes.entries()) {
            if (activeNodes.has(node)) {
              if (!mostRecentActive || time > (nodeStartTimes.get(mostRecentActive) || 0)) {
                mostRecentActive = node;
              }
            }
          }
        }
      }
    }

    if (mostRecentActive && activeNodes.has(mostRecentActive)) {
      setActiveNode(mostRecentActive);
    } else if (activeNodes.size > 0) {
      setActiveNode(Array.from(activeNodes)[0]);
    } else {
      setActiveNode(null);
    }

    setCompletedNodes(completedNodesSet);
  }, [events, schemaNodes, NODE_IDS]);

  const edges: Edge[] = useMemo(
    () =>
      schemaEdges.map((e, i) => {
        const flowing =
          (activeNode === e.source || activeNode === e.target) ||
          (completedNodes.has(e.source) && (activeNode === e.target || !completedNodes.has(e.target)));
        return {
          id: `e-${e.source}-${e.target}-${i}`,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: flowing || Boolean(e.label),
          style: flowing
            ? { stroke: "#2563eb", strokeWidth: 2 }
            : completedNodes.has(e.source) && completedNodes.has(e.target)
              ? { stroke: "#16a34a", strokeWidth: 1.5 }
              : undefined,
        };
      }),
    [schemaEdges, activeNode, completedNodes]
  );

  const nodes: Node[] = useMemo(() => {
    const base: Node[] = schemaNodes.map((n) => {
      const agentConfig = config.agents.find((a) => a.id === n.id);
      const meta = agentMetaMap[n.id] ?? (agentConfig ? {
        id: agentConfig.id,
        label: agentConfig.label,
        role: agentConfig.role,
        tools: agentConfig.tools,
        routesTo: agentConfig.routesTo,
        model: agentConfig.model,
      } : undefined);
      const metrics = computeAgentMetrics(events, n.id, workerIds);
      const toolCount = extractToolCalls(events, n.id, workerIds).length;
      const status = getAgentNodeState(events, n.id, workerIds);
      const isActive = n.id === activeNode;
      const isDone = completedNodes.has(n.id) || status === "done";
      const isSelected = n.id === selectedNodeId;
      const savedPos =
        n.id === "supervisor" ? supervisorPosition : agentConfig?.position;

      return {
        id: n.id,
        type: "agentNode",
        data: {
          label: meta?.label ?? n.label,
          role: meta?.role,
          model: meta?.model ?? agentConfig?.model,
          tools: meta?.tools,
          status,
          toolCount,
          tokens: metrics.tokens,
          isActive,
          isNext: false,
          isDone,
          isSelected,
          editable,
        } satisfies AgentNodeData,
        position: savedPos ?? { x: 0, y: 0 },
        selectable: true,
        draggable: editable,
        connectable: editable,
      };
    });

    return layoutNodes(base, edges);
  }, [
    schemaNodes,
    config.agents,
    edges,
    activeNode,
    completedNodes,
    events,
    agentMetaMap,
    selectedNodeId,
    editable,
    supervisorPosition,
  ]);

  const persistPositions = useCallback(
    (nextSupervisor: { x: number; y: number }, movedAgents: { id: string; position: { x: number; y: number } }[]) => {
      if (dragPersistTimer.current) clearTimeout(dragPersistTimer.current);
      dragPersistTimer.current = setTimeout(() => {
        const agents = config.agents.map((a) => {
          const moved = movedAgents.find((m) => m.id === a.id);
          return moved ? { ...a, position: moved.position } : a;
        });
        void saveConfig({ ...config, agents });
      }, 400);
    },
    [config, saveConfig]
  );

  const onNodeDragStop: NodeDragHandler = useCallback(
    (_, node) => {
      if (!editable) return;
      if (node.id === "supervisor") {
        setSupervisorPosition(node.position);
        return;
      }
      persistPositions(supervisorPosition, [{ id: node.id, position: node.position }]);
    },
    [editable, persistPositions, supervisorPosition]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!editable || !connection.source || !connection.target) return;
      void addEdge({ source: connection.source, target: connection.target });
    },
    [editable, addEdge]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (onNodeSelect) {
        onNodeSelect(selectedNodeId === node.id ? null : node.id);
      }
    },
    [onNodeSelect, selectedNodeId]
  );

  const handleDeleteSelected = useCallback(() => {
    if (!selectedNodeId || selectedNodeId === "supervisor") return;
    void removeAgent(selectedNodeId);
    onNodeSelect?.(null);
  }, [selectedNodeId, removeAgent, onNodeSelect]);

  return (
    <div className="flex flex-col h-full min-h-[300px]">
      {editable && (
        <div className="flex items-center justify-between gap-2 mb-2 shrink-0 flex-wrap">
          <p className="text-xs text-charcoal-muted">
            Drag nodes, connect handles, or launch agents from chat with{" "}
            <code className="bg-charcoal-raised px-1 rounded text-charcoal-text">@agent task</code>
          </p>
          <div className="flex items-center gap-2">
            {selectedNodeId && selectedNodeId !== "supervisor" && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="text-xs px-2.5 py-1 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10"
              >
                Delete agent
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="text-xs px-2.5 py-1 rounded-lg bg-charcoal-accent text-white hover:brightness-110"
            >
              + Add agent
            </button>
          </div>
        </div>
      )}

      {activeNode && (
        <div className="mb-2 shrink-0">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-charcoal-raised rounded-md border border-charcoal-border text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-charcoal-accent animate-pulse" />
            <span className="font-medium text-charcoal-muted">
              Executing: <span className="text-charcoal-text capitalize">{activeNode}</span>
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-[280px] w-full rounded-xl overflow-hidden border border-charcoal-border bg-charcoal-bg">
        <ReactFlow
          key={schemaNodes.map((n) => n.id).join("|") || "blank"}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={editable}
          nodesConnectable={editable}
          elementsSelectable
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          proOptions={{ hideAttribution: true }}
          style={{ background: "#1c1c1f" }}
        >
          <MiniMap
            style={{ backgroundColor: "#2a2a2e" }}
            maskColor="rgba(28, 28, 31, 0.7)"
            nodeColor="#3f3f46"
          />
          <Controls className="!bg-charcoal-surface !border-charcoal-border !shadow-none [&>button]:!bg-charcoal-surface [&>button]:!border-charcoal-border [&>button]:!fill-charcoal-muted" />
          <Background color="#3f3f46" gap={16} />
        </ReactFlow>
      </div>

      <AgentCreateModal
        open={showCreateModal}
        availableTools={availableTools}
        availableSkills={availableSkills}
        availableModels={availableModels}
        existingIds={agentIds}
        onClose={() => setShowCreateModal(false)}
        onCreate={(agent) => void addAgent(agent)}
      />
    </div>
  );
}

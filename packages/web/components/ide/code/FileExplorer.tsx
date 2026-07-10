"use client";

import { useState } from "react";
import type { WorkspaceTreeNode } from "../../../app/api-client";

type FileExplorerProps = {
  tree: WorkspaceTreeNode[];
  selectedPath?: string;
  onOpenFile: (path: string) => void;
};

function TreeNode({
  node,
  depth,
  selectedPath,
  onOpenFile,
}: {
  node: WorkspaceTreeNode;
  depth: number;
  selectedPath?: string;
  onOpenFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (node.type === "file") {
    const active = selectedPath === node.path;
    return (
      <button
        type="button"
        onClick={() => onOpenFile(node.path)}
        className={`w-full text-left px-2 py-1 text-xs font-mono truncate rounded ${
          active
            ? "bg-charcoal-accent/15 text-charcoal-accent"
            : "text-charcoal-muted hover:text-charcoal-text hover:bg-charcoal-raised/60"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        title={node.path}
      >
        {node.name}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-2 py-1 text-xs font-medium text-charcoal-text hover:bg-charcoal-raised/60 rounded"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <span className="text-charcoal-muted mr-1">{open ? "▾" : "▸"}</span>
        {node.name}
      </button>
      {open &&
        node.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onOpenFile={onOpenFile}
          />
        ))}
    </div>
  );
}

export default function FileExplorer({ tree, selectedPath, onOpenFile }: FileExplorerProps) {
  if (!tree.length) {
    return (
      <p className="text-xs text-charcoal-muted p-3">
        No files yet. Run a task with coding agents to populate the workspace.
      </p>
    );
  }

  return (
    <div className="py-1">
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}

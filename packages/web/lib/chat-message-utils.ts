import type { ChatMessage } from "./types/chat";

export type ChatMessageVariant =
  | "user"
  | "assistant"
  | "status"
  | "graph-update"
  | "error"
  | "confirmation";

export function classifyChatMessage(message: ChatMessage): ChatMessageVariant {
  if (message.role === "status") return "status";
  if (message.role === "user") return "user";

  const text = message.content.trim();
  if (text.startsWith("Error:")) return "error";
  if (text.includes("Reply **yes**") || text.includes("Confirm graph edit")) return "confirmation";
  if (/Updated the canvas with \d+ agent/i.test(text)) return "graph-update";

  return "assistant";
}

export function formatChatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function statusLabel(status: string, isRunning: boolean): string {
  if (isRunning) return "Running";
  if (status === "error") return "Error";
  if (status === "completed") return "Ready";
  if (status === "idle") return "Idle";
  return "Ready";
}

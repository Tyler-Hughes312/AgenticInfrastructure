export type ChatMessageRole = "user" | "assistant" | "status";

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  content: string;
  ts: number;
  runId?: string;
};

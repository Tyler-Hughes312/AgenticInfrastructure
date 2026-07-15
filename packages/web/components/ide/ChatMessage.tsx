"use client";

import type { ChatMessage } from "../../lib/types/chat";
import {
  classifyChatMessage,
  formatChatTime,
  type ChatMessageVariant,
} from "../../lib/chat-message-utils";
import ChatMarkdown from "./ChatMarkdown";

type ChatMessageProps = {
  message: ChatMessage;
  isLive?: boolean;
};

const LABEL: Record<ChatMessageVariant, string> = {
  user: "You",
  assistant: "Orchestrator",
  status: "Activity",
  "graph-update": "Graph",
  error: "Error",
  confirmation: "Confirm",
};

const ACCENT: Record<ChatMessageVariant, string> = {
  user: "border-charcoal-accent/50",
  assistant: "border-charcoal-border",
  status: "border-transparent",
  "graph-update": "border-violet-500/40",
  error: "border-red-500/40",
  confirmation: "border-amber-500/40",
};

export default function ChatMessageBubble({ message, isLive }: ChatMessageProps) {
  const variant = classifyChatMessage(message);
  const time = formatChatTime(message.ts);

  if (variant === "status") {
    return (
      <div className="px-3 py-1.5 border-l-2 border-emerald-500/30 ml-3">
        <div className="flex items-center gap-2 text-xs text-charcoal-muted font-mono min-w-0">
          {isLive && (
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
          )}
          <span className="text-charcoal-muted/50 shrink-0 tabular-nums">{time}</span>
          <span className="truncate">{message.content}</span>
        </div>
      </div>
    );
  }

  const label = LABEL[variant];
  const align = variant === "user" ? "text-right" : "text-left";

  return (
    <article
      className={`px-3 py-2.5 border-l-2 ${ACCENT[variant]} ml-3 mr-1`}
      style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
    >
      <header className={`flex items-baseline gap-2 mb-1.5 ${align === "text-right" ? "justify-end" : ""}`}>
        <span className="text-[10px] text-charcoal-muted/60 tabular-nums shrink-0">{time}</span>
        <span className="text-[11px] font-medium text-charcoal-muted">{label}</span>
      </header>
      <div className={`text-sm leading-relaxed text-charcoal-text ${align}`}>
        <ChatMarkdown content={message.content} variant="assistant" />
      </div>
    </article>
  );
}

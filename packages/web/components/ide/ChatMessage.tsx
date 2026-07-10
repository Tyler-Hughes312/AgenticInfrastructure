"use client";

import type { ChatMessage } from "../../lib/types/chat";
import ChatMarkdown from "./ChatMarkdown";

type ChatMessageProps = {
  message: ChatMessage;
};

export default function ChatMessageBubble({ message }: ChatMessageProps) {
  if (message.role === "status") {
    return (
      <div className="px-3 py-1">
        <div className="text-xs text-charcoal-muted break-words leading-relaxed">
          <ChatMarkdown content={message.content} variant="assistant" />
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} px-3 py-1.5`}>
      <div
        className={`max-w-full rounded-2xl px-3 py-2.5 text-sm break-words overflow-hidden ${
          isUser ? "bg-charcoal-accent text-white" : "bg-charcoal-raised text-charcoal-text"
        }`}
        style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
      >
        <ChatMarkdown content={message.content} variant={isUser ? "user" : "assistant"} />
      </div>
    </div>
  );
}

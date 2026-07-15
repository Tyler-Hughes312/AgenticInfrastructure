"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import ActivityBar from "./ActivityBar";
import {
  CHAT_OPEN_KEY,
  DEFAULT_CHAT_WIDTH,
  MIN_CHAT_WIDTH,
  MAX_CHAT_WIDTH_RATIO,
  getStoredChatWidth,
  setChatPanelOpen,
  setStoredChatWidth,
} from "../../lib/ide-chat-panel";

type IdeLayoutProps = {
  main: ReactNode;
  chat: ReactNode;
  contextBar?: ReactNode;
};

export default function IdeLayout({ main, chat, contextBar }: IdeLayoutProps) {
  const pathname = usePathname();
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_CHAT_WIDTH);
  const chatWidthRef = useRef(chatWidth);
  chatWidthRef.current = chatWidth;

  useEffect(() => {
    const stored = localStorage.getItem(CHAT_OPEN_KEY);
    if (stored !== null) {
      setChatOpen(stored === "true");
    } else {
      setChatOpen(pathname !== "/code");
    }

    const storedWidth = getStoredChatWidth();
    if (storedWidth !== null) {
      const maxWidth = Math.floor(window.innerWidth * MAX_CHAT_WIDTH_RATIO);
      setChatWidth(Math.min(maxWidth, Math.max(MIN_CHAT_WIDTH, storedWidth)));
    }

    const handler = (e: Event) => {
      setChatOpen((e as CustomEvent<boolean>).detail);
    };
    window.addEventListener("ide-chat-open", handler);
    return () => window.removeEventListener("ide-chat-open", handler);
  }, [pathname]);

  const setChatOpenPersisted = useCallback((open: boolean) => {
    setChatOpen(open);
    setChatPanelOpen(open);
  }, []);

  const onMouseMove = useCallback((e: globalThis.MouseEvent) => {
    if (!dragging.current) return;
    const delta = startX.current - e.clientX;
    const maxWidth = Math.floor(window.innerWidth * MAX_CHAT_WIDTH_RATIO);
    const next = Math.min(maxWidth, Math.max(MIN_CHAT_WIDTH, startWidth.current + delta));
    setChatWidth(next);
  }, []);

  const onMouseUp = useCallback(() => {
    if (dragging.current) {
      setStoredChatWidth(chatWidthRef.current);
    }
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  function startResize(e: MouseEvent<HTMLDivElement>) {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = chatWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-charcoal-bg relative">
      <ActivityBar />
      <div className="flex flex-1 min-w-0 min-h-0 h-full flex-col">
        {contextBar}
        <div className="flex flex-1 min-w-0 min-h-0">
          <div className="flex-1 min-w-0 h-full overflow-hidden">{main}</div>
          {chatOpen && (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize chat panel"
                onMouseDown={startResize}
                className="w-1 shrink-0 cursor-col-resize bg-charcoal-border hover:bg-charcoal-accent/60 transition-colors"
              />
              <div
                className="shrink-0 h-full overflow-hidden border-l border-charcoal-border"
                style={{ width: chatWidth, minWidth: MIN_CHAT_WIDTH }}
              >
                {chat}
              </div>
            </>
          )}
        </div>
      </div>

      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpenPersisted(true)}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex items-center gap-1 px-2 py-3 rounded-l-lg bg-charcoal-surface border border-r-0 border-charcoal-border text-charcoal-muted hover:bg-charcoal-raised hover:text-charcoal-text shadow-lg"
          aria-label="Open orchestrator chat"
        >
          <span className="text-xs font-medium writing-mode-vertical">Chat</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
    </div>
  );
}

export const CHAT_OPEN_KEY = "ide-chat-open";
export const CHAT_WIDTH_KEY = "ide-chat-width";

export const DEFAULT_CHAT_WIDTH = 300;
export const MIN_CHAT_WIDTH = 260;
export const MAX_CHAT_WIDTH_RATIO = 0.38;

export function setChatPanelOpen(open: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CHAT_OPEN_KEY, String(open));
  window.dispatchEvent(new CustomEvent("ide-chat-open", { detail: open }));
}

export function isChatPanelOpen(pathname = "/"): boolean {
  if (typeof window === "undefined") return pathname !== "/code";
  const stored = localStorage.getItem(CHAT_OPEN_KEY);
  if (stored !== null) return stored === "true";
  return pathname !== "/code";
}

export function getStoredChatWidth(): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(CHAT_WIDTH_KEY);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function setStoredChatWidth(width: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CHAT_WIDTH_KEY, String(Math.round(width)));
}

export function defaultChatOpenForPath(pathname: string): boolean {
  return isChatPanelOpen(pathname);
}

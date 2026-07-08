export const CHAT_OPEN_KEY = "ide-chat-open";

export function setChatPanelOpen(open: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CHAT_OPEN_KEY, String(open));
  window.dispatchEvent(new CustomEvent("ide-chat-open", { detail: open }));
}

export function isChatPanelOpen(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(CHAT_OPEN_KEY);
  return stored === null ? true : stored === "true";
}

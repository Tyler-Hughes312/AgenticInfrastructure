import type { editor } from "monaco-editor";

export const CHARCOAL_MONACO_THEME = "charcoal-dark";

export function defineCharcoalMonacoTheme(monaco: typeof import("monaco-editor")): void {
  monaco.editor.defineTheme(CHARCOAL_MONACO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#1c1c1f",
      "editor.foreground": "#e4e4e7",
      "editorLineNumber.foreground": "#71717a",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editor.selectionBackground": "#5b8def44",
      "editor.inactiveSelectionBackground": "#5b8def22",
      "editorCursor.foreground": "#5b8def",
      "editor.lineHighlightBackground": "#2a2a2e",
      "editorGutter.background": "#1c1c1f",
      "diffEditor.insertedTextBackground": "#16a34a33",
      "diffEditor.removedTextBackground": "#ef444433",
      "diffEditor.border": "#3f3f46",
    },
  });
}

export function languageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    mdx: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    yml: "yaml",
    yaml: "yaml",
    sh: "shell",
    sql: "sql",
    csv: "plaintext",
    txt: "plaintext",
    xml: "xml",
  };
  return map[ext] ?? "plaintext";
}

export const monacoEditorOptions: editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  minimap: { enabled: true },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  wordWrap: "on",
  padding: { top: 12, bottom: 12 },
};

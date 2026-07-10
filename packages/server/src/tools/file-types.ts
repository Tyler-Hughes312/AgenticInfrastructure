/** Supported workspace output extensions and MIME types for download/export. */

export const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "html",
  "htm",
  "css",
  "scss",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "xml",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "sql",
  "sh",
  "bash",
  "zsh",
  "env",
  "toml",
  "ini",
  "cfg",
  "conf",
  "log",
  "svg",
]);

export const DOCUMENT_EXTENSIONS = new Set(["md", "markdown", "txt", "html", "htm", "docx", "csv"]);

export function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function isTextFile(path: string): boolean {
  const ext = extensionOf(path);
  if (!ext) return true;
  return TEXT_EXTENSIONS.has(ext);
}

export function mimeTypeForPath(path: string): string {
  const ext = extensionOf(path);
  const map: Record<string, string> = {
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    markdown: "text/markdown; charset=utf-8",
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    yaml: "application/yaml; charset=utf-8",
    yml: "application/yaml; charset=utf-8",
    ts: "text/typescript; charset=utf-8",
    tsx: "text/typescript; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    jsx: "text/javascript; charset=utf-8",
    py: "text/x-python; charset=utf-8",
    svg: "image/svg+xml",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    zip: "application/zip",
  };
  return map[ext] ?? "application/octet-stream";
}

export const AGENT_OUTPUT_FORMATS_HELP =
  "Supported outputs: code (.ts, .py, .js, …), documents (.md, .txt, .html, .docx), data (.json, .csv, .yaml), " +
  "configs, logs, and any UTF-8 text. Use write_file / write_document; put essays in docs/, code in src/, reports in output/.";

"use client";

import { DiffEditor, loader } from "@monaco-editor/react";
import { useEffect } from "react";
import {
  CHARCOAL_MONACO_THEME,
  defineCharcoalMonacoTheme,
  languageFromPath,
} from "./monaco-theme";

type DiffEditorPaneProps = {
  path: string;
  before: string;
  after: string;
};

export default function DiffEditorPane({ path, before, after }: DiffEditorPaneProps) {
  useEffect(() => {
    void loader.init().then((monaco) => {
      defineCharcoalMonacoTheme(monaco);
    });
  }, []);

  const language = languageFromPath(path);

  return (
    <DiffEditor
      height="100%"
      language={language}
      theme={CHARCOAL_MONACO_THEME}
      original={before}
      modified={after}
      options={{
        readOnly: true,
        renderSideBySide: true,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      }}
    />
  );
}

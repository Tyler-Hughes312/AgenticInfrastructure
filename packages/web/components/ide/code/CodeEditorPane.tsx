"use client";

import Editor, { loader } from "@monaco-editor/react";
import { useEffect } from "react";
import {
  CHARCOAL_MONACO_THEME,
  defineCharcoalMonacoTheme,
  languageFromPath,
  monacoEditorOptions,
} from "./monaco-theme";

type CodeEditorPaneProps = {
  path: string;
  content: string;
  onChange: (value: string) => void;
};

export default function CodeEditorPane({ path, content, onChange }: CodeEditorPaneProps) {
  useEffect(() => {
    void loader.init().then((monaco) => {
      defineCharcoalMonacoTheme(monaco);
    });
  }, []);

  return (
    <Editor
      height="100%"
      language={languageFromPath(path)}
      theme={CHARCOAL_MONACO_THEME}
      value={content}
      onChange={(v) => onChange(v ?? "")}
      options={monacoEditorOptions}
    />
  );
}

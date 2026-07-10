"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

type ChatMarkdownProps = {
  content: string;
  variant?: "assistant" | "user";
};

const assistantComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => (
    <h1 className="text-base font-semibold mb-2 mt-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-semibold mb-2 mt-3 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-medium mb-1.5 mt-2 first:mt-0">{children}</h3>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-charcoal-border pl-3 my-2 text-charcoal-muted italic">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-charcoal-accent underline underline-offset-2 hover:brightness-110"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return <code className={`${className} font-mono text-xs leading-relaxed`}>{children}</code>;
    }
    return (
      <code className="rounded bg-charcoal-bg px-1 py-0.5 text-[0.85em] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-charcoal-bg border border-charcoal-border px-3 py-2 text-xs font-mono leading-relaxed">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-charcoal-border" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-charcoal-border px-2 py-1 text-left font-semibold bg-charcoal-bg">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-charcoal-border px-2 py-1 align-top">{children}</td>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
};

const userComponents: Components = {
  ...assistantComponents,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return <code className={`${className} font-mono text-xs leading-relaxed`}>{children}</code>;
    }
    return (
      <code className="rounded bg-white/15 px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-white/10 px-3 py-2 text-xs font-mono leading-relaxed">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-white/30 pl-3 my-2 italic opacity-90">
      {children}
    </blockquote>
  ),
};

export default function ChatMarkdown({ content, variant = "assistant" }: ChatMarkdownProps) {
  if (!content.trim()) return null;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={variant === "user" ? userComponents : assistantComponents}
    >
      {content}
    </ReactMarkdown>
  );
}

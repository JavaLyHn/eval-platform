import { useState } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

// 只注册技能仓里会出现的语言(_TEXT_EXTS),控制包体。
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("markdown", markdown);

const EXT_LANG: Record<string, string> = {
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  jsx: "javascript",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  md: "markdown",
  mdx: "markdown",
};

/** 由文件路径推断 Prism 语言;未知 → "" (纯文本不高亮)。 */
export function langForFile(path?: string): string {
  if (!path) return "";
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
  return EXT_LANG[ext] ?? "";
}

interface CodeViewerProps {
  code: string;
  /** 文件路径或名称,用于推断语言 + 标题栏显示。 */
  path?: string;
  /** 标题栏显示的文件名(缺省取 path 末段)。 */
  filename?: string;
  className?: string;
}

/**
 * VSCode 风格代码查看器:深色编辑器外壳(红黄绿圆点 + 文件名 + 语言 + 复制)
 * + Prism「VS Code Dark+」主题高亮 + 行号。
 */
export function CodeViewer({ code, path, filename, className }: CodeViewerProps) {
  const [copied, setCopied] = useState(false);
  const lang = langForFile(path);
  const name = filename ?? (path ? path.split("/").pop() ?? "" : "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用(非 https / 权限)→ 静默 */
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] shadow-sm",
        className,
      )}
    >
      {/* 标题栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#3c3c3c] bg-[#252526] px-3 py-1.5">
        <span className="flex shrink-0 gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
        </span>
        {name && (
          <span className="ml-1 min-w-0 truncate font-mono text-[11px] text-[#cccccc]">
            {name}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[#858585]">
            {lang || "text"}
          </span>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-[#cccccc] transition hover:bg-white/10"
          >
            {copied ? (
              <Check className="h-3 w-3 text-[#27c93f]" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "已复制" : "复制"}
          </button>
        </span>
      </div>
      {/* 代码体 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <SyntaxHighlighter
          language={lang || undefined}
          style={vscDarkPlus}
          showLineNumbers
          customStyle={{
            margin: 0,
            background: "transparent",
            padding: "12px 0",
            fontSize: "12px",
            lineHeight: "1.6",
          }}
          lineNumberStyle={{
            minWidth: "2.75em",
            paddingRight: "1em",
            color: "#858585",
            userSelect: "none",
          }}
          codeTagProps={{
            style: {
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
            },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

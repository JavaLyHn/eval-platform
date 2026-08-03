import { memo } from "react";
import { cn } from "@/lib/utils";
import { FileCard } from "@/components/agent-panel/file-card";
import { isFileLikeCodeBlock, fileNameForCodeBlock } from "@/lib/message-files";

/**
 * Minimal, dependency-free Markdown renderer for chat messages.
 * Supports headings, bold/italic, inline code, fenced code blocks, lists,
 * blockquotes, links. Renders to JSX; sanitized by virtue of never using
 * dangerouslySetInnerHTML except for inline formatting (escaped).
 */

type Block =
  | { type: "code"; lang: string; content: string; info?: string }
  | { type: "heading"; level: 1 | 2 | 3; content: string }
  | { type: "quote"; content: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; content: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "hr" };

function parseBlocks(src: string): Block[] {
  const lines = src.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code
    const fence = line.match(/^```(\w*)[ \t]*(.*)$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const info = (fence[2] ?? "").trim() || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: "code", lang, content: buf.join("\n"), info });
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      blocks.push({
        type: "heading",
        level: h[1].length as 1 | 2 | 3,
        content: h[2],
      });
      i++;
      continue;
    }

    // hr
    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // GFM 表格:表头行 + 分隔行(|---|---|)
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      lines[i + 1].includes("|") &&
      /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])
    ) {
      const splitRow = (s: string) =>
        s
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const header = splitRow(line);
      i += 2; // 跳过表头 + 分隔行
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", content: buf.join("\n") });
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Blank
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph (multi-line until blank)
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(```|#{1,3}\s|>\s?|\s*[-*]\s+|\s*\d+\.\s+|[-*_]{3,})/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", content: buf.join("\n") });
  }
  return blocks;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 只允许 http(s) 与 data:image —— 防 javascript:/其它协议注入。 */
function isSafeImgUrl(u: string): boolean {
  return /^(https?:\/\/|data:image\/)/i.test(u);
}
/** URL 是否指向图片(扩展名或 data:image)。 */
function isImageUrl(u: string): boolean {
  return /^data:image\//i.test(u) || /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?[^\s]*)?$/i.test(u.split("#")[0]);
}
function imgTag(url: string, alt: string): string {
  return `<img src="${url}" alt="${alt}" class="msg-img" loading="lazy" />`;
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  // inline code first to avoid clobbering
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // 图片 ![alt](url) —— 必须在链接之前处理(否则链接正则会先吃掉 [alt](url) 部分,图片就丢了)
  out = out.replace(
    /!\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/g,
    (m, alt, u) => (isSafeImgUrl(u) ? imgTag(u, alt) : m),
  );
  // links [text](url):指向图片的链接也直接渲染成图片,其余照常成 <a>
  out = out.replace(
    /\[([^\]]+)\]\(\s*([^)\s]+)[^)]*\)/g,
    (_, t, u) =>
      isSafeImgUrl(u) && isImageUrl(u)
        ? imgTag(u, t)
        : `<a href="${u}" target="_blank" rel="noreferrer">${t}</a>`,
  );
  // 裸图片 URL(http(s) 且以图片扩展名结尾)→ 直接出图;前缀限行首/空白/「(」,避免命中已生成标签里的 URL
  out = out.replace(
    /(^|[\s(])(https?:\/\/[^\s<>"')]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp)(?:\?[^\s<>"')]*)?)/gi,
    (_, pre, u) => `${pre}${imgTag(u, "")}`,
  );
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return out;
}

interface MarkdownProps {
  children: string;
  className?: string;
  /** 开启后:file-like 代码块渲成可下载 FileCard(仅聊天助手气泡用)。 */
  fileCards?: boolean;
}

export const Markdown = memo(function Markdown({
  children,
  className,
  fileCards = false,
}: MarkdownProps) {
  const blocks = parseBlocks(children);
  let fileIdx = 0;
  return (
    <div className={cn("prose-msg", className)}>
      {blocks.map((b, idx) => {
        switch (b.type) {
          case "heading": {
            const Tag = `h${b.level}` as const;
            return (
              <Tag
                key={idx}
                dangerouslySetInnerHTML={{ __html: renderInline(b.content) }}
              />
            );
          }
          case "code": {
            if (fileCards && isFileLikeCodeBlock(b.lang, b.content, b.info)) {
              const filename = fileNameForCodeBlock(b.lang, b.info, fileIdx++);
              return (
                <FileCard
                  key={idx}
                  filename={filename}
                  text={b.content}
                  defaultExpanded={b.content.length <= 400}
                />
              );
            }
            return (
              <pre key={idx}>
                <code className={b.lang ? `language-${b.lang}` : undefined}>
                  {b.content}
                </code>
              </pre>
            );
          }
          case "quote":
            return (
              <blockquote
                key={idx}
                dangerouslySetInnerHTML={{ __html: renderInline(b.content) }}
              />
            );
          case "ul":
            return (
              <ul key={idx}>
                {b.items.map((it, j) => (
                  <li
                    key={j}
                    dangerouslySetInnerHTML={{ __html: renderInline(it) }}
                  />
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={idx}>
                {b.items.map((it, j) => (
                  <li
                    key={j}
                    dangerouslySetInnerHTML={{ __html: renderInline(it) }}
                  />
                ))}
              </ol>
            );
          case "table":
            return (
              <div key={idx} className="my-2 overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {b.header.map((h, j) => (
                        <th
                          key={j}
                          className="border border-border bg-muted/50 px-2.5 py-1.5 text-left font-semibold"
                          dangerouslySetInnerHTML={{ __html: renderInline(h) }}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            className="border border-border px-2.5 py-1.5 align-top"
                            dangerouslySetInnerHTML={{ __html: renderInline(cell) }}
                          />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={idx} className="my-3 border-border" />;
          case "p":
          default:
            return (
              <p
                key={idx}
                dangerouslySetInnerHTML={{
                  __html: renderInline((b as { content: string }).content),
                }}
              />
            );
        }
      })}
    </div>
  );
});

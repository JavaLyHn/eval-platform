/**
 * 紧凑的 Markdown → HTML 字符串转换,用于报告「导出 HTML」(faithful 呈现 agent 回答 /
 * 题面里的加粗 / 列表 / 代码 / 表格等)。覆盖与站内 Markdown 组件同一批常见语法:
 * 标题 / 加粗 / 斜体 / 行内代码 / 围栏代码 / 有序·无序列表 / 引用 / 分隔线 / 表格 / 链接 / 段落。
 * 一切用户内容都转义,无 XSS 面(链接仅允许 http(s)/mailto)。纯函数,可单测。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 行内格式:按「行内代码」切段,只对非代码段做转义 + 链接/加粗/斜体,代码段单独转义包 code。
 * 切段法避免占位符/哨兵,天然不会把普通数字误当代码,也不会在代码里再套格式。
 */
function inline(s: string): string {
  return s
    .split(/(`[^`]+`)/g)
    .map((part) => {
      const code = /^`([^`]+)`$/.exec(part);
      if (code) return `<code>${escapeHtml(code[1])}</code>`;
      let t = escapeHtml(part);
      // 链接 [文本](url):仅允许 http(s) / mailto,避免 javascript: 之类。
      t = t.replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g,
        (_, txt, url) =>
          `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>`,
      );
      t = t.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
      return t;
    })
    .join("");
}

const isBlank = (l: string) => /^\s*$/.test(l);
const isFence = (l: string) => /^```/.test(l);
const isHeading = (l: string) => /^#{1,6}\s/.test(l);
const isUl = (l: string) => /^\s*[-*+]\s+/.test(l);
const isOl = (l: string) => /^\s*\d+[.)]\s+/.test(l);
const isQuote = (l: string) => /^\s*>\s?/.test(l);
const isHr = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);

export function mdToHtml(src: string): string {
  if (!src || !src.trim()) return "";
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  const parseTableRow = (l: string): string[] =>
    l
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (isFence(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 收尾 fence
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (isBlank(line)) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(6, h[1].length);
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (isHr(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    // 表格:本行含 | 且下一行是分隔行(含 - 与 |)。
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
      lines[i + 1].includes("-")
    ) {
      const header = parseTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      const thead = `<tr>${header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>`;
      const tbody = rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`);
      continue;
    }
    if (isUl(line)) {
      const items: string[] = [];
      while (i < lines.length && isUl(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      out.push(`<ul>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ul>`);
      continue;
    }
    if (isOl(line)) {
      const items: string[] = [];
      while (i < lines.length && isOl(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      out.push(`<ol>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ol>`);
      continue;
    }
    if (isQuote(line)) {
      const buf: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${buf.map(inline).join("<br>")}</blockquote>`);
      continue;
    }
    // 段落:攒到空行或下一个块起点。
    const buf: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !isFence(lines[i]) &&
      !isHeading(lines[i]) &&
      !isUl(lines[i]) &&
      !isOl(lines[i]) &&
      !isQuote(lines[i]) &&
      !isHr(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length) out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

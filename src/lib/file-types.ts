/** 文件类型底座:扩展名 / 代码语言 → 描述符(标签/MIME/图标)。上传芯片与下载卡片共用。 */

export type FileKind = "code" | "markdown" | "pdf" | "data" | "doc" | "archive" | "text" | "generic";
export type IconName = "code" | "markdown" | "pdf" | "data" | "doc" | "text" | "file";
export type FileDescriptor = { ext: string; kind: FileKind; label: string; mime: string; iconName: IconName };

const LANG_EXT: Record<string, string> = {
  markdown: "md", md: "md", html: "html", htm: "html",
  javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  python: "py", py: "py", json: "json", yaml: "yml", yml: "yml", xml: "xml", svg: "svg",
  csv: "csv", tsv: "tsv", sh: "sh", bash: "sh", shell: "sh", sql: "sql", css: "css",
  go: "go", java: "java", rb: "rb", ruby: "rb", rs: "rs", rust: "rs",
  c: "c", cpp: "cpp", "c++": "cpp", cs: "cs", php: "php", toml: "toml", ini: "ini",
  text: "txt", plaintext: "txt", "": "txt",
};
export function langToExt(lang: string): string {
  const k = lang.trim().toLowerCase();
  return LANG_EXT[k] ?? (k || "txt");
}

type Row = Omit<FileDescriptor, "ext">;
const CODE_EXT = new Set(["js","jsx","ts","tsx","py","go","java","rb","rs","c","cpp","cs","php","sh","sql","css","toml","ini"]);
const EXT_ROW: Record<string, Row> = {
  html: { kind: "code", label: "代码 · HTML", mime: "text/html", iconName: "code" },
  htm:  { kind: "code", label: "代码 · HTML", mime: "text/html", iconName: "code" },
  xml:  { kind: "code", label: "代码 · XML", mime: "application/xml", iconName: "code" },
  svg:  { kind: "code", label: "代码 · SVG", mime: "image/svg+xml", iconName: "code" },
  md:   { kind: "markdown", label: "Markdown", mime: "text/markdown", iconName: "markdown" },
  txt:  { kind: "text", label: "文本 · TXT", mime: "text/plain", iconName: "text" },
  log:  { kind: "text", label: "日志 · LOG", mime: "text/plain", iconName: "text" },
  csv:  { kind: "data", label: "数据 · CSV", mime: "text/csv", iconName: "data" },
  tsv:  { kind: "data", label: "数据 · TSV", mime: "text/tab-separated-values", iconName: "data" },
  json: { kind: "data", label: "数据 · JSON", mime: "application/json", iconName: "data" },
  yml:  { kind: "data", label: "数据 · YAML", mime: "text/yaml", iconName: "data" },
  yaml: { kind: "data", label: "数据 · YAML", mime: "text/yaml", iconName: "data" },
  pdf:  { kind: "pdf", label: "文档 · PDF", mime: "application/pdf", iconName: "pdf" },
  zip:  { kind: "archive", label: "压缩包 · ZIP", mime: "application/zip", iconName: "file" },
  docx: { kind: "doc", label: "文档 · DOCX", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", iconName: "doc" },
  xlsx: { kind: "doc", label: "表格 · XLSX", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", iconName: "doc" },
  pptx: { kind: "doc", label: "幻灯 · PPTX", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", iconName: "doc" },
};

export function describeExt(extOrName: string): FileDescriptor {
  const raw = extOrName.includes(".") ? extOrName.split(".").pop()! : extOrName;
  const ext = raw.trim().toLowerCase();
  const row = EXT_ROW[ext];
  if (row) return { ext, ...row };
  if (CODE_EXT.has(ext)) return { ext, kind: "code", label: `代码 · ${ext.toUpperCase()}`, mime: "text/plain", iconName: "code" };
  return { ext, kind: "generic", label: `文件 · ${(ext || "?").toUpperCase()}`, mime: "application/octet-stream", iconName: "file" };
}

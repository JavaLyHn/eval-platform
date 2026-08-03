/** 助手回复里的「file-like 代码块」判定与命名(供 Markdown 渲成 FileCard)。纯逻辑。 */
import { langToExt } from "./file-types";

const DOC_CODE_LANGS = new Set([
  "html","htm","markdown","md","xml","svg","json","yaml","yml","csv","tsv","css",
  "js","jsx","ts","tsx","py","python","go","java","rb","ruby","rs","rust",
  "c","cpp","cs","php","sh","bash","sql","toml","ini",
]);
const FILENAME_RE = /([\w./-]+\.[A-Za-z0-9]{1,8})(?:\s|$)/;

/** 信息串里的文件名(取 basename);无则 null。 */
export function fileNameHint(info?: string): string | null {
  if (!info) return null;
  const m = info.trim().match(FILENAME_RE);
  return m ? m[1].split("/").pop()! : null;
}

/** 该围栏块是否值得渲成文件卡片。 */
export function isFileLikeCodeBlock(lang: string, content: string, info?: string): boolean {
  if (fileNameHint(info)) return true;
  if (!DOC_CODE_LANGS.has(lang.trim().toLowerCase())) return false;
  return content.split("\n").length >= 8 || content.length >= 400;
}

/** 该块文件名:信息串文件名 > 兜底 `文件-<n>.<ext>`。 */
export function fileNameForCodeBlock(lang: string, info: string | undefined, index: number): string {
  return fileNameHint(info) ?? `文件-${index + 1}.${langToExt(lang)}`;
}

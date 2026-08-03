/** 从 agent 轨迹里抠「非图片文件」URL(pdf/md/csv/docx/zip/html…),供助手气泡下方出下载卡片。
 *  与 transcript-images 互斥(图片交给它)。照同一套 walk/去重/限量/限深。 */
import type { AgentTranscript } from "@/types";

export type TranscriptFile = { url: string; filename: string; ext: string };

const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?[^\s]*)?$/i;
const FILE_EXT_RE = /\.(pdf|md|markdown|csv|tsv|json|ya?ml|xml|html?|txt|log|docx?|xlsx?|pptx?|zip|tar|gz|rtf)(\?[^\s]*)?$/i;
const MAX_FILES = 12;
const MAX_DEPTH = 6;

function isHttpUrl(s: string): boolean { return /^https?:\/\/\S+$/i.test(s); }
function fnameFromUrl(u: string): string {
  const bare = u.split("#")[0];
  let path = bare;
  try { path = new URL(bare).pathname; } catch { /* 用原串 */ }
  const last = path.split("/").pop() || "file";
  try { return decodeURIComponent(last.split("?")[0]) || "file"; } catch { return last.split("?")[0] || "file"; }
}

function walk(value: unknown, out: Map<string, TranscriptFile>, depth: number): void {
  if (depth > MAX_DEPTH || out.size >= MAX_FILES) return;
  if (typeof value === "string") {
    const s = value.trim();
    if (isHttpUrl(s)) {
      const bare = s.split("#")[0];
      if (FILE_EXT_RE.test(bare) && !IMG_EXT_RE.test(bare)) {
        const filename = fnameFromUrl(s);
        const ext = (filename.split(".").pop() || "").toLowerCase();
        if (!out.has(s)) out.set(s, { url: s, filename, ext });
      }
      return;
    }
    if ((s.startsWith("{") || s.startsWith("[")) && s.length < 200_000) {
      try { walk(JSON.parse(s), out, depth + 1); } catch { /* 非 JSON */ }
    }
    return;
  }
  if (Array.isArray(value)) { for (const v of value) walk(v, out, depth + 1); return; }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) walk(v, out, depth + 1);
  }
}

export function extractTranscriptFiles(transcript?: AgentTranscript | null): TranscriptFile[] {
  if (!transcript?.steps?.length) return [];
  const out = new Map<string, TranscriptFile>();
  for (const step of transcript.steps) {
    walk(step.output, out, 0);
    walk(step.toolInput, out, 0);
    if (out.size >= MAX_FILES) break;
  }
  return [...out.values()];
}

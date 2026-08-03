/**
 * 从 agent 轨迹(AgentTranscript)里深挖「图片 URL」,供聊天气泡内联展示。
 *
 * 背景:Platform 生成的图片不在助手回复正文里,而是经工具(白名单 panel_show /
 * preview_file 等)产出,URL 落在轨迹步骤的 output / toolInput 里。聊天气泡只渲染
 * 正文文本,于是「图片真实存在却显示不出来」。这里把轨迹里的图片 URL 抠出来。
 *
 * 判定(尽量召回、宁可多给——展示侧对加载失败的 <img> 用 onError 自动隐藏,假阳无害):
 *  - data:image/... 一律算图片;
 *  - http(s) 且以图片扩展名结尾(.png/.jpg/.webp/...)算图片;
 *  - http(s) 且所在键名/工具名暗示图片或文件(image/img/cover/thumb/photo/file/url/src/preview…)也算。
 * 仅白名单工具的 output/toolInput 才有内容(其余被后端脱敏),所以扫到的本就有限。
 */
import type { AgentTranscript } from "@/types";

const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?[^\s]*)?$/i;
const NON_IMG_FILE_RE = /\.(md|markdown|pdf|csv|tsv|json|ya?ml|xml|html?|txt|log|docx?|xlsx?|pptx?|zip|tar|gz|rtf)(\?[^\s]*)?$/i;
const IMG_KEY_RE = /(image|img|cover|thumb|photo|pic|avatar|file|url|src|preview|attachment|media)/i;
const MAX_IMAGES = 12;
const MAX_DEPTH = 6;

function isImageDataUrl(s: string): boolean {
  return /^data:image\//i.test(s);
}
function isHttpUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s);
}

function walk(value: unknown, keyHint: string, out: Set<string>, depth: number): void {
  if (depth > MAX_DEPTH || out.size >= MAX_IMAGES) return;
  if (typeof value === "string") {
    const s = value.trim();
    if (isImageDataUrl(s)) {
      out.add(s);
      return;
    }
    if (isHttpUrl(s)) {
      const bare = s.split("#")[0];
      if (!NON_IMG_FILE_RE.test(bare) && (IMG_EXT_RE.test(bare) || IMG_KEY_RE.test(keyHint))) {
        out.add(s);
      }
      return;
    }
    // 工具出参常是 JSON 字符串(如 preview_file 的 output={"url":"…png"})→ 解析后继续深挖。
    if ((s.startsWith("{") || s.startsWith("[")) && s.length < 200_000) {
      try {
        walk(JSON.parse(s), keyHint, out, depth + 1);
      } catch {
        /* 不是 JSON,忽略 */
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, keyHint, out, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, k, out, depth + 1);
    }
  }
}

/** 抽取轨迹里的图片 URL(去重、有上限);无轨迹返回空数组。 */
export function extractTranscriptImages(
  transcript?: AgentTranscript | null,
): string[] {
  if (!transcript?.steps?.length) return [];
  const out = new Set<string>();
  for (const step of transcript.steps) {
    // 顶层键名用工具名当线索(如 preview_file 的 output 直接是个文件 URL)。
    walk(step.output, step.toolName ?? "", out, 0);
    walk(step.toolInput, step.toolName ?? "", out, 0);
    if (out.size >= MAX_IMAGES) break;
  }
  return [...out];
}

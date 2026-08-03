import type { AgentTranscript } from "@/types";
import { transcriptOutputFiles } from "@/lib/transcript-output-files";

export interface JudgeAttachment { filename: string; text: string; truncated: boolean; }
export interface JudgeAttachmentsResult { files: JudgeAttachment[]; omittedCount: number; }
export const JUDGE_ATTACH_CAPS = { perFileCap: 8000, totalCap: 16000 };

/** agent 产出的文本文件 → 判分附件:去重 + 单文件/合计截断。仅文本类(transcriptOutputFiles 给 .text 的)。 */
export function collectJudgeFileTexts(
  transcripts: Array<AgentTranscript | null | undefined>,
  caps = JUDGE_ATTACH_CAPS,
): JudgeAttachmentsResult {
  const seen = new Set<string>();
  const files: JudgeAttachment[] = [];
  let used = 0;
  let omittedCount = 0;
  for (const t of transcripts) {
    if (!t) continue;
    for (const pf of transcriptOutputFiles(t)) {
      if (pf.text == null) continue; // 仅文本类
      const key = `${pf.filename}|${pf.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const remaining = caps.totalCap - used;
      if (remaining <= 0) { omittedCount += 1; continue; }
      const allow = Math.min(caps.perFileCap, remaining);
      const truncated = pf.text.length > allow;
      const text = truncated ? pf.text.slice(0, allow) : pf.text;
      files.push({ filename: pf.filename, text, truncated });
      used += text.length;
    }
  }
  return { files, omittedCount };
}

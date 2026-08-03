import { shortId } from "@/lib/utils";
import type { Question } from "@/types";

export type ImportRowState = "importable" | "duplicate";

export interface ImportPreviewRow {
  question: Question;
  state: ImportRowState;
  defaultChecked: boolean;
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  counts: { parsed: number; importable: number; duplicate: number };
}

/**
 * 内容指纹:title + prompt + subPrompts 归一(去首尾 / 合并连续空白 / 小写)。
 * id / number 判重不可靠 —— 导入前 assignFreshIds 必换新 id;CSV/xlsx 无号列时
 * normalizeQuestion 会给随机 number,同一道题重复导入每次号都不同。内容一致即同一道题,
 * 以此判「导入过」。两侧(预览 + 入库)共用,判据一致。
 */
export function questionContentSig(q: {
  title?: string;
  prompt?: string;
  subPrompts?: string[];
}): string {
  const norm = (s: string | undefined) =>
    (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return [norm(q.title), norm(q.prompt), ...(q.subPrompts ?? []).map(norm)].join(
    "␟",
  );
}

/**
 * 逐条判定导入预览:打库归属 kind(文件显式合法 kind 优先,否则当前库)、
 * 判重(与现有库或本批已见的 id / number / **内容指纹** 撞车 → duplicate)、给默认勾选。
 */
export function buildImportPreview(
  parsed: Question[],
  existing: Question[],
  bankKind: "agent" | "skill",
): ImportPreview {
  const existingIds = new Set(existing.map((e) => e.id));
  const existingNums = new Set(existing.map((e) => e.number));
  const existingSigs = new Set(existing.map((e) => questionContentSig(e)));
  const seenIds = new Set<string>();
  const seenNums = new Set<string>();
  const seenSigs = new Set<string>();

  const rows: ImportPreviewRow[] = [];
  let importable = 0;
  let duplicate = 0;

  for (const raw of parsed) {
    const kind: "agent" | "skill" =
      raw.kind === "agent" || raw.kind === "skill" ? raw.kind : bankKind;
    const question: Question = { ...raw, kind };
    const sig = questionContentSig(question);

    const isDup =
      existingIds.has(question.id) ||
      existingNums.has(question.number) ||
      existingSigs.has(sig) ||
      seenIds.has(question.id) ||
      seenNums.has(question.number) ||
      seenSigs.has(sig);

    if (isDup) {
      duplicate++;
      rows.push({ question, state: "duplicate", defaultChecked: false });
    } else {
      importable++;
      seenIds.add(question.id);
      seenNums.add(question.number);
      seenSigs.add(sig);
      rows.push({ question, state: "importable", defaultChecked: true });
    }
  }

  return { rows, counts: { parsed: parsed.length, importable, duplicate } };
}

/** 导入入库前给每题铸新 id(只换 id,其余字段全留)。questions 是全局主键,
 *  跨账号导入(导入别人导出的题)保留原 id 会撞原主人 → 换新 id 成为本账号新题。 */
export function assignFreshIds(qs: Question[]): Question[] {
  return qs.map((q) => ({ ...q, id: shortId("q") }));
}

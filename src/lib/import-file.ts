import * as XLSX from "xlsx";
import type { Question } from "@/types";
import {
  parseQuestionsFromJSON,
  jsonQuestionArray,
  csvSplitRecords,
  rowsToQuestions,
  rowsToQuestionsWithRaw,
  questionToRawRecord,
  hasRequiredColumns,
} from "./io";

export type ImportFormat = "json" | "csv" | "xlsx";

export interface ParsedImportFile {
  parsed: Question[];
  totalRows: number;
  format: ImportFormat;
  hasRequired: boolean;
}

/**
 * 按扩展名解析上传文件为题目 + 原始行数(用于算「无法识别」)。
 * xlsx/xls 只取第一个 sheet,首行当表头,转成与 CSV 同构的字符串行喂 rowsToQuestions。
 */
export async function parseImportFile(file: File): Promise<ParsedImportFile> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".json")) {
    const text = await file.text();
    return {
      parsed: parseQuestionsFromJSON(text),
      totalRows: jsonQuestionArray(text).length,
      format: "json",
      hasRequired: true,
    };
  }

  if (name.endsWith(".csv")) {
    const text = await file.text();
    const records = csvSplitRecords(text);
    return {
      parsed: rowsToQuestions(records),
      totalRows: Math.max(0, records.length - 1),
      format: "csv",
      hasRequired: records.length > 0 ? hasRequiredColumns(records[0]) : false,
    };
  }

  // .xlsx / .xls(及其它交给 SheetJS 试解)
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const first = wb.SheetNames[0];
  if (!first) return { parsed: [], totalRows: 0, format: "xlsx", hasRequired: false };
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first], {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });
  const records = aoa.map((row) =>
    Array.isArray(row) ? row.map((c) => String(c ?? "")) : [],
  );
  return {
    parsed: rowsToQuestions(records),
    totalRows: Math.max(0, records.length - 1),
    format: "xlsx",
    hasRequired: records.length > 0 ? hasRequiredColumns(records[0]) : false,
  };
}

const ACCEPTED_IMPORT_EXT = /\.(xlsx|xls|csv|json)$/i;

export function isAcceptedImportFile(name: string): boolean {
  return ACCEPTED_IMPORT_EXT.test(name.trim());
}

export interface ParsedImportBatch {
  parsed: Question[];
  totalRows: number;
  fileCount: number;
  skipped: string[];
  errors: { name: string; message: string }[];
  missingRequired: boolean;
}

/** 批量解析多文件:按扩展名筛选,逐个解析,合并 parsed + 累加 totalRows,跳过/错误分列收集。 */
export async function parseImportFiles(files: File[]): Promise<ParsedImportBatch> {
  const parsed: Question[] = [];
  let totalRows = 0;
  let fileCount = 0;
  const skipped: string[] = [];
  const errors: { name: string; message: string }[] = [];
  let missingRequired = false;
  for (const f of files) {
    if (!isAcceptedImportFile(f.name)) {
      skipped.push(f.name);
      continue;
    }
    try {
      const res = await parseImportFile(f);
      parsed.push(...res.parsed);
      totalRows += res.totalRows;
      fileCount++;
      if (!res.hasRequired && res.parsed.length === 0) missingRequired = true;
    } catch (e) {
      errors.push({ name: f.name, message: (e as Error).message });
    }
  }
  return { parsed, totalRows, fileCount, skipped, errors, missingRequired };
}

export interface ImportSource {
  key: string;
  fileName: string;
  sheetName?: string;
  parsed: Question[];
  /** 与 parsed 同长同序:每题的原始全列(表头→单元格);LLM 规范化用。 */
  rawRecords: Record<string, string>[];
  totalRows: number;
  hasRequired: boolean;
}

export interface ImportSourcesResult {
  sources: ImportSource[];
  skipped: string[];
  errors: { name: string; message: string }[];
}

/** 把多文件解析成「来源」列表:xlsx 每 sheet 一个来源,csv/json 各一个。 */
export async function parseImportSources(files: File[]): Promise<ImportSourcesResult> {
  const sources: ImportSource[] = [];
  const skipped: string[] = [];
  const errors: { name: string; message: string }[] = [];
  for (const f of files) {
    const name = f.name;
    if (!isAcceptedImportFile(name)) {
      skipped.push(name);
      continue;
    }
    const lower = name.toLowerCase();
    try {
      if (lower.endsWith(".json")) {
        const text = await f.text();
        const parsed = parseQuestionsFromJSON(text);
        sources.push({
          key: `${name}::`,
          fileName: name,
          parsed,
          rawRecords: parsed.map(questionToRawRecord),
          totalRows: jsonQuestionArray(text).length,
          hasRequired: true,
        });
      } else if (lower.endsWith(".csv")) {
        const text = await f.text();
        const records = csvSplitRecords(text);
        const paired = rowsToQuestionsWithRaw(records);
        sources.push({
          key: `${name}::`,
          fileName: name,
          parsed: paired.map((x) => x.question),
          rawRecords: paired.map((x) => x.raw),
          totalRows: Math.max(0, records.length - 1),
          hasRequired: records.length > 0 ? hasRequiredColumns(records[0]) : false,
        });
      } else {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        for (const sheetName of wb.SheetNames) {
          const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
            header: 1,
            defval: "",
            blankrows: false,
            raw: false,
          });
          const records = aoa.map((row) =>
            Array.isArray(row) ? row.map((c) => String(c ?? "")) : [],
          );
          const paired = rowsToQuestionsWithRaw(records);
          sources.push({
            key: `${name}::${sheetName}`,
            fileName: name,
            sheetName,
            parsed: paired.map((x) => x.question),
            rawRecords: paired.map((x) => x.raw),
            totalRows: Math.max(0, records.length - 1),
            hasRequired: records.length > 0 ? hasRequiredColumns(records[0]) : false,
          });
        }
      }
    } catch (e) {
      errors.push({ name, message: (e as Error).message });
    }
  }
  return { sources, skipped, errors };
}

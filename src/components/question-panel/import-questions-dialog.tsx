import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileDown, FolderOpen, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQAStore } from "@/hooks/use-qa-store";
import { parseImportSources, type ImportSource } from "@/lib/import-file";
import { buildImportPreview, assignFreshIds } from "@/lib/question-import";
import { downloadBlob, importTemplateCSV } from "@/lib/io";
import { cn } from "@/lib/utils";
import { getProfileKind } from "@/agents/registry";
import {
  buildNormalizePrompt,
  parseNormalizedQuestion,
  normalizedQuestionToImport,
} from "@/lib/question-normalize";
import { STANDARD_EMPLOYEES } from "@/lib/standard-employees";
import { GATEWAY_EMPLOYEES } from "@/lib/extended-employees";
import type { Question } from "@/types";

type FsEntry = {
  isFile: boolean;
  isDirectory: boolean;
  file?: (cb: (f: File) => void, err?: () => void) => void;
  createReader?: () => {
    readEntries: (cb: (e: FsEntry[]) => void, err?: () => void) => void;
  };
};

/** 从 drop 的 DataTransfer 收集文件;若拖入文件夹则用 webkitGetAsEntry 递归。 */
async function gatherDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const roots: FsEntry[] = [];
  const items = dt.items;
  if (items && items.length) {
    for (let i = 0; i < items.length; i++) {
      const getEntry = (items[i] as unknown as {
        webkitGetAsEntry?: () => FsEntry | null;
      }).webkitGetAsEntry;
      const entry = typeof getEntry === "function" ? getEntry.call(items[i]) : null;
      if (entry) roots.push(entry);
    }
  }
  if (!roots.length) return Array.from(dt.files);
  const out: File[] = [];
  const walk = (entry: FsEntry): Promise<void> =>
    new Promise((resolve) => {
      if (entry.isFile && entry.file) {
        entry.file(
          (f) => {
            out.push(f);
            resolve();
          },
          () => resolve(),
        );
      } else if (entry.isDirectory && entry.createReader) {
        const reader = entry.createReader();
        const readBatch = () =>
          reader.readEntries(
            async (ents) => {
              if (!ents.length) {
                resolve();
                return;
              }
              await Promise.all(ents.map(walk));
              readBatch();
            },
            () => resolve(),
          );
        readBatch();
      } else {
        resolve();
      }
    });
  await Promise.all(roots.map(walk));
  return out;
}

const IMPORT_EMPLOYEES = [...STANDARD_EMPLOYEES, ...GATEWAY_EMPLOYEES];

export function ImportQuestionsDialog({
  open,
  onOpenChange,
  bankKind,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bankKind: "agent" | "skill";
}) {
  const { questions, importQuestions, showNotice, profiles, runOneShot } = useQAStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [sources, setSources] = useState<ImportSource[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<string[]>([]);
  const [fileErrors, setFileErrors] = useState<{ name: string; message: string }[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const [dragOver, setDragOver] = useState(false);

  // ── LLM 规范化导入 ──
  const [useLLM, setUseLLM] = useState(false);
  const [normProfileId, setNormProfileId] = useState<string | null>(null);
  const [targetEmpId, setTargetEmpId] = useState("");
  const [phase, setPhase] = useState<"preview" | "normalizing" | "review">("preview");
  const [normalized, setNormalized] = useState<{ q: Question; original: { title: string; prompt: string } }[]>([]);
  const [failedRows, setFailedRows] = useState<{ index: number; title: string; message: string }[]>([]);
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const llmProfiles = useMemo(
    () => profiles.filter((p) => getProfileKind(p.providerId) === "llm"),
    [profiles],
  );

  const bankLabel = bankKind === "skill" ? "Skill 库" : "Agent 库";

  const selectedSources = useMemo(
    () => sources.filter((s) => selectedKeys.has(s.key)),
    [sources, selectedKeys],
  );
  const preview = useMemo(
    () => buildImportPreview(selectedSources.flatMap((s) => s.parsed), questions, bankKind),
    [selectedSources, questions, bankKind],
  );
  // 与 preview.rows 索引对齐(buildImportPreview 不丢行、保序)。
  const rawRecords = useMemo(
    () => selectedSources.flatMap((s) => s.rawRecords),
    [selectedSources],
  );
  const rows = preview.rows;
  const totalRows = selectedSources.reduce((n, s) => n + s.totalRows, 0);
  const importableCount = rows.filter((r) => r.state === "importable").length;
  const duplicateCount = rows.filter((r) => r.state === "duplicate").length;
  const unreadable = Math.max(0, totalRows - rows.length);
  const pickedCount = checked.size;
  // 全选/取消全选:以「可导入(默认勾选)」的行为全选目标;全选时按钮切成取消全选。
  const selectableIdx = useMemo(
    () => rows.map((r, i) => (r.defaultChecked ? i : -1)).filter((i) => i >= 0),
    [rows],
  );
  const allSelected =
    selectableIdx.length > 0 && selectableIdx.every((i) => checked.has(i));
  const toggleSelectAll = () =>
    setChecked(allSelected ? new Set() : new Set(selectableIdx));
  const showSources = sources.length > 1 || sources.some((s) => s.sheetName != null);
  const missingRequired =
    rows.length === 0 &&
    selectedSources.length > 0 &&
    selectedSources.every((s) => !s.hasRequired);

  useEffect(() => {
    const init = new Set<number>();
    rows.forEach((r, i) => {
      if (r.defaultChecked) init.add(i);
    });
    setChecked(init);
    // 仅在 preview 结果变化时重播种勾选
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  // 打开 LLM 开关且没选模型 → 默认第一个 LLM。
  useEffect(() => {
    if (useLLM && !normProfileId && llmProfiles.length > 0)
      setNormProfileId(llmProfiles[0].id);
  }, [useLLM, normProfileId, llmProfiles]);

  const reset = () => {
    setParsing(false);
    setError("");
    setSources([]);
    setSelectedKeys(new Set());
    setSkipped([]);
    setFileErrors([]);
    setChecked(new Set());
    setDragOver(false);
    if (fileRef.current) fileRef.current.value = "";
    if (dirRef.current) dirRef.current.value = "";
    setUseLLM(false);
    setNormProfileId(null);
    setTargetEmpId("");
    setPhase("preview");
    setNormalized([]);
    setFailedRows([]);
    setPending(new Set());
    setBusy(false);
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setParsing(true);
    setError("");
    try {
      const res = await parseImportSources(files);
      setSources(res.sources);
      setSkipped(res.skipped);
      setFileErrors(res.errors);
      const init = new Set<string>();
      res.sources.forEach((s) => {
        if (s.hasRequired && s.parsed.length > 0) init.add(s.key);
      });
      setSelectedKeys(init);
    } catch (e) {
      setError(`解析失败:${(e as Error).message}`);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
      if (dirRef.current) dirRef.current.value = "";
    }
  };

  const toggleSource = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = await gatherDroppedFiles(e.dataTransfer);
    void handleFiles(files);
  };

  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const doImport = () => {
    const picked = rows.filter((_, i) => checked.has(i)).map((r) => r.question);
    if (picked.length === 0) return;
    // 直接导入(不走 LLM 规范化)也应用「目标员工」:挂 targetEmployeeId + 并入 categories
    // (与 LLM 流 normalizedQuestionToImport 的挂法一致)。未选员工则原样导入。
    const tagged = targetEmpId
      ? picked.map((q) => ({
          ...q,
          targetEmployeeId: targetEmpId,
          categories: Array.from(
            new Set([targetEmpId, ...(q.categories ?? [])]),
          ),
        }))
      : picked;
    const { added, skipped } = importQuestions(assignFreshIds(tagged), "append");
    showNotice({
      kind: "success",
      message: `已导入 ${added} 道到${bankLabel}${skipped > 0 ? `,跳过重复 ${skipped} 道` : ""}`,
    });
    reset();
    onOpenChange(false);
  };

  // 逐条规范化(并发 3);成功进 normalized、失败进 failedRows;pending 用于流动显示。
  const normalizeIndices = async (indices: number[]) => {
    if (!normProfileId || indices.length === 0) return;
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const emp = targetEmpId ? IMPORT_EMPLOYEES.find((e) => e.id === targetEmpId) : undefined;
    const anchor = emp
      ? { name: emp.name, title: emp.title, coreTasks: emp.coreTasks, outOfScope: emp.outOfScope }
      : undefined;
    setPending((prev) => new Set([...prev, ...indices]));
    let cursor = 0;
    const worker = async () => {
      while (!ac.signal.aborted) {
        const pos = cursor++;
        if (pos >= indices.length) break;
        const i = indices[pos];
        try {
          const raw = await runOneShot(
            normProfileId,
            buildNormalizePrompt({ rawRecord: rawRecords[i] ?? {}, employee: anchor }),
            { timeoutMs: 120_000, signal: ac.signal },
          );
          const gq = parseNormalizedQuestion(raw);
          if (!gq) throw new Error("未解析出规范化题目");
          const base = rows[i].question;
          const q = normalizedQuestionToImport(base, gq, emp?.id);
          setNormalized((prev) => [
            ...prev,
            { q, original: { title: base.title, prompt: base.prompt } },
          ]);
          setFailedRows((prev) => prev.filter((f) => f.index !== i));
        } catch (e) {
          if (ac.signal.aborted) return;
          setFailedRows((prev) => [
            ...prev.filter((f) => f.index !== i),
            { index: i, title: rows[i].question.title, message: (e as Error).message },
          ]);
        } finally {
          setPending((prev) => {
            const n = new Set(prev);
            n.delete(i);
            return n;
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(3, indices.length) }, () => worker()),
    );
    abortRef.current = null;
    setBusy(false);
  };

  const startNormalize = () => {
    const targets = rows.map((_, i) => i).filter((i) => checked.has(i));
    if (!normProfileId || targets.length === 0) return;
    setNormalized([]);
    setFailedRows([]);
    setPending(new Set());
    setPhase("normalizing");
    void normalizeIndices(targets).then(() => setPhase("review"));
  };

  const retryFailed = () => {
    const idx = failedRows.map((f) => f.index);
    if (idx.length === 0) return;
    setPending(new Set());
    setPhase("normalizing");
    void normalizeIndices(idx).then(() => setPhase("review"));
  };

  const stopNormalize = () => abortRef.current?.abort();

  const confirmImport = () => {
    if (normalized.length === 0) return;
    const { added, skipped } = importQuestions(
      assignFreshIds(normalized.map((n) => n.q)),
      "append",
    );
    showNotice({
      kind: "success",
      message: `已导入 ${added} 道到${bankLabel}${skipped > 0 ? `,跳过重复 ${skipped} 道` : ""}`,
    });
    reset();
    onOpenChange(false);
  };

  const downloadTemplate = () =>
    downloadBlob("qa-questions-template.csv", importTemplateCSV(), "text/csv;charset=utf-8");

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>导入题目 → {bankLabel}</DialogTitle>
          <DialogDescription>
            支持 xlsx / xls / csv / json。预览无误后再导入;列名见模板。
          </DialogDescription>
        </DialogHeader>

        {phase === "preview" && (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/json"
              className="hidden"
              onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
            />
            <input
              ref={dirRef}
              type="file"
              {...({ webkitdirectory: "" } as unknown as Record<string, string>)}
              className="hidden"
              onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
            />
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
                dragOver ? "border-accent bg-accent/10" : "border-border",
              )}
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <div className="text-[12px] text-muted-foreground">把文件或文件夹拖到这里,或</div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 gap-1 text-[12px]"
                  disabled={parsing}
                  onClick={() => fileRef.current?.click()}
                >
                  {parsing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  浏览文件
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 gap-1 text-[12px]"
                  disabled={parsing}
                  onClick={() => dirRef.current?.click()}
                >
                  <FolderOpen className="h-3.5 w-3.5" /> 选文件夹
                </Button>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <FileDown className="h-3.5 w-3.5" /> 下载模板
                </button>
              </div>
              <div className="text-[10.5px] text-muted-foreground/70">
                支持 xlsx / xls / csv / json,可多选
              </div>
            </div>

            {error && <div className="text-[11px] text-destructive">{error}</div>}

            {showSources && (
              <div className="max-h-28 shrink-0 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
                <div className="px-1 text-[10.5px] text-muted-foreground">
                  选择要导入的来源(sheet / 文件):
                </div>
                {sources.map((s) => (
                  <label
                    key={s.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11.5px] hover:bg-secondary/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(s.key)}
                      onChange={() => toggleSource(s.key)}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {s.fileName}
                      {s.sheetName ? (
                        <span className="text-muted-foreground"> › {s.sheetName}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{s.totalRows} 行</span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[9.5px]",
                        s.hasRequired && s.parsed.length > 0
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {s.hasRequired ? `可导入 ${s.parsed.length}` : "缺标题/题面"}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {(rows.length > 0 || skipped.length > 0 || fileErrors.length > 0 || selectedSources.length > 0) && (
              <div className="space-y-0.5 text-[11px] text-muted-foreground">
                <div>
                  {selectedSources.length > 0 && (
                    <>
                      <span className="font-mono text-foreground">{selectedSources.length}</span> 个来源 ·{" "}
                    </>
                  )}
                  共 <span className="font-mono text-foreground">{totalRows}</span> 行 · 可导入{" "}
                  <span className="font-mono text-foreground">{importableCount}</span> · 重复{" "}
                  <span className="font-mono text-foreground">{duplicateCount}</span> · 无法识别{" "}
                  <span className="font-mono text-foreground">{unreadable}</span>
                </div>
                {skipped.length > 0 && (
                  <div className="text-warning">跳过 {skipped.length} 个非支持文件</div>
                )}
                {fileErrors.length > 0 && (
                  <div className="text-destructive">
                    {fileErrors.length} 个文件解析失败:{fileErrors.map((e) => e.name).join("、")}
                  </div>
                )}
              </div>
            )}

            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
              {rows.length > 0 && (
                <div className="mx-1 mb-2 space-y-2 rounded-md border border-border p-2">
                  <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={useLLM}
                      onChange={(e) => setUseLLM(e.target.checked)}
                    />
                    用 LLM 规范化导入(把不规范的题整理成标准题,保原意)
                  </label>
                  {/* 目标员工:不论是否走 LLM 规范化都可选,直接导入也会给选中的题挂上该员工。 */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground">目标员工</span>
                    <select
                      value={targetEmpId}
                      onChange={(e) => setTargetEmpId(e.target.value)}
                      className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px]"
                    >
                      <option value="">通用(不指定员工)</option>
                      {IMPORT_EMPLOYEES.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                    <span className="text-[10px] text-muted-foreground">
                      给导入的题挂上该员工(直接导入亦生效)
                    </span>
                  </div>
                  {useLLM && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-muted-foreground">规范器模型</span>
                      <select
                        value={normProfileId ?? ""}
                        onChange={(e) => setNormProfileId(e.target.value || null)}
                        className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px]"
                      >
                        {llmProfiles.length === 0 && <option value="">无可用 LLM 模型</option>}
                        {llmProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
              <ul className="space-y-1 px-1 pb-2">
                {rows.length === 0 && !parsing && (
                  <li className="px-2 py-10 text-center text-[11.5px] text-muted-foreground">
                    {missingRequired
                      ? "未找到 标题 / 题面 列(如 用例标题 + 测试数据),请对照要求。"
                      : sources.length > 0 || skipped.length > 0 || fileErrors.length > 0
                        ? "没有可导入的题目(勾选上面有数据的来源,或检查格式)。"
                        : "拖入或选择文件开始。"}
                  </li>
                )}
                {rows.map((r, i) => {
                  const dup = r.state === "duplicate";
                  return (
                    <li
                      key={i}
                      className={cn(
                        "rounded-md border bg-card text-[12px]",
                        checked.has(i) ? "border-foreground/40" : "border-border",
                      )}
                    >
                      <div
                        className={cn(
                          "flex items-center gap-2 px-2.5 py-2",
                          !checked.has(i) && "opacity-60",
                        )}
                      >
                        <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                        {/* 点标题区展开详情(与勾选互不干扰) */}
                        <button
                          type="button"
                          onClick={() => toggleExpand(i)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          title="点击查看题目详情"
                        >
                          <span className="w-16 shrink-0 truncate font-mono text-[10.5px] text-muted-foreground">
                            {r.question.number}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">{r.question.title}</span>
                          <span className="hidden shrink-0 truncate text-[10.5px] text-muted-foreground sm:inline">
                            {(r.question.categories ?? []).join("·")} · {r.question.difficulty}
                          </span>
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                              expanded.has(i) && "rotate-180",
                            )}
                          />
                        </button>
                        <span
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-[9.5px]",
                            dup ? "bg-warning/15 text-warning" : "bg-success/15 text-success",
                          )}
                        >
                          {dup ? "重复·跳过" : "可导入"}
                        </span>
                      </div>
                      {expanded.has(i) && (
                        <div className="px-2.5 pb-2">
                          <QuestionFieldsDetail q={r.question} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}

        {phase === "normalizing" && (
          <>
            <div className="shrink-0 text-[12px] text-muted-foreground">
              规范化中… 已完成{" "}
              <span className="font-mono text-success">{normalized.length}</span> · 失败{" "}
              <span className="font-mono text-destructive">{failedRows.length}</span> · 剩余{" "}
              <span className="font-mono text-foreground">{pending.size}</span>
            </div>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
              <ul className="space-y-1 px-1 pb-2">
                {/* 失败项即时列出(含原因),不必等规范化全部结束 */}
                {failedRows.map((f) => (
                  <li
                    key={`nf-${f.index}`}
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11.5px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 truncate font-mono text-[10.5px] text-destructive/80">
                        {rows[f.index]?.question.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-destructive">
                        失败:{f.title}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                      {f.message || "(无错误详情)"}
                    </div>
                  </li>
                ))}
                {rows.map((r, i) =>
                  pending.has(i) ? (
                    <li
                      key={i}
                      className="flex animate-pulse items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-[12px]"
                    >
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                      <span className="w-16 shrink-0 truncate font-mono text-[10.5px] text-muted-foreground">
                        {r.question.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{r.question.title}</span>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          </>
        )}

        {phase === "review" && (
          <>
            <div className="shrink-0 text-[12px] text-muted-foreground">
              规范化完成:<span className="font-mono text-success">{normalized.length}</span> 道待导入
              {failedRows.length > 0 && (
                <>
                  {" "}· <span className="font-mono text-destructive">{failedRows.length}</span> 道失败
                </>
              )}。请核对后确认导入。
            </div>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
              <ul className="space-y-1 px-1 pb-2">
                {normalized.map((n) => (
                  <NormalizedCard key={n.q.id} q={n.q} original={n.original} />
                ))}
                {failedRows.map((f) => (
                  <li
                    key={`f-${f.index}`}
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11.5px]"
                  >
                    <div className="font-medium text-destructive">失败:{f.title}</div>
                    <div className="text-[10.5px] text-muted-foreground">
                      {f.message || "(无错误详情)"}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <DialogFooter className="items-center justify-between sm:justify-between">
          {phase === "preview" && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  勾选 {pickedCount} / {rows.length} 道
                </span>
                {selectableIdx.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-[11px] font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {allSelected ? "取消全选" : "全选"}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    reset();
                    onOpenChange(false);
                  }}
                >
                  取消
                </Button>
                {useLLM ? (
                  <Button
                    size="sm"
                    disabled={pickedCount === 0 || !normProfileId}
                    onClick={startNormalize}
                  >
                    开始规范化 {pickedCount} 道
                  </Button>
                ) : (
                  <Button size="sm" disabled={pickedCount === 0} onClick={doImport}>
                    导入 {pickedCount} 道到{bankLabel}
                  </Button>
                )}
              </div>
            </>
          )}
          {phase === "normalizing" && (
            <>
              <span className="text-[11px] text-muted-foreground">规范化中…</span>
              <Button variant="ghost" size="sm" onClick={stopNormalize}>
                停止
              </Button>
            </>
          )}
          {phase === "review" && (
            <>
              <span className="text-[11px] text-muted-foreground">
                {normalized.length} 道待导入
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPhase("preview")}>
                  返回
                </Button>
                {failedRows.length > 0 && (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={retryFailed}>
                    重试失败 {failedRows.length}
                  </Button>
                )}
                <Button size="sm" disabled={busy || normalized.length === 0} onClick={confirmImport}>
                  确认导入 {normalized.length} 道
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 一道题的关键字段详情(题面 / 后续轮 / Pass / Fail / 参考);预览行点开时显示。 */
function QuestionFieldsDetail({ q }: { q: Question }) {
  return (
    <div className="space-y-1 border-t border-border pt-1.5 text-[11px] text-muted-foreground">
      <div><span className="text-foreground">题面:</span> {q.prompt || "(空)"}</div>
      {q.subPrompts && q.subPrompts.length > 0 && (
        <div>
          <span className="text-foreground">后续轮({q.subPrompts.length + 1} 轮):</span>{" "}
          {q.subPrompts.join(" / ")}
        </div>
      )}
      {q.passForm && <div><span className="text-foreground">Pass:</span> {q.passForm}</div>}
      {q.failForm && <div><span className="text-foreground">Fail:</span> {q.failForm}</div>}
      {q.referenceAnswer && (
        <div><span className="text-foreground">参考:</span> {q.referenceAnswer}</div>
      )}
      {(q.severity || q.intent) && (
        <div className="text-[10.5px]">
          {q.severity ? `严重度 ${q.severity}` : ""}
          {q.severity && q.intent ? " · " : ""}
          {q.intent ? `意图 ${q.intent}` : ""}
        </div>
      )}
    </div>
  );
}

/** review 阶段:规范化后的一道题,点开看关键字段 + 原始题面对照(核对是否改了原意)。 */
function NormalizedCard({
  q,
  original,
}: {
  q: Question;
  original?: { title: string; prompt: string };
}) {
  const [open, setOpen] = useState(false);
  const promptChanged = original != null && original.prompt.trim() !== q.prompt.trim();
  return (
    <li className="rounded-md border border-border bg-card px-2.5 py-2 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="w-16 shrink-0 truncate font-mono text-[10.5px] text-muted-foreground">
          {q.number}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{q.title}</span>
        {promptChanged && (
          <span className="shrink-0 rounded bg-warning/15 px-1 text-[9.5px] text-warning">
            题面已改写
          </span>
        )}
        {q.attachments && q.attachments.length > 0 && (
          <span className="shrink-0 rounded bg-accent/15 px-1 text-[9.5px] text-accent">
            附件×{q.attachments.length}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {q.difficulty}
          {q.subPrompts && q.subPrompts.length > 0 ? ` · ${q.subPrompts.length + 1} 轮` : ""}
          {q.severity ? ` · ${q.severity}` : ""}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 border-t border-border pt-1.5 text-[11px] text-muted-foreground">
          {original && (
            <div className="rounded bg-muted/40 px-1.5 py-1">
              <span className="text-foreground">原始题面:</span> {original.prompt}
            </div>
          )}
          <div>
            <span className="text-foreground">规范化题面:</span> {q.prompt}
          </div>
          {q.subPrompts && q.subPrompts.length > 0 && (
            <div><span className="text-foreground">后续轮:</span> {q.subPrompts.join(" / ")}</div>
          )}
          {q.passForm && <div><span className="text-foreground">Pass:</span> {q.passForm}</div>}
          {q.failForm && <div><span className="text-foreground">Fail:</span> {q.failForm}</div>}
          {q.referenceAnswer && (
            <div><span className="text-foreground">参考:</span> {q.referenceAnswer}</div>
          )}
          {q.attachments && q.attachments.length > 0 && (
            <div className="rounded bg-accent/10 px-1.5 py-1">
              <span className="text-foreground">附件(AI 自拟,随题发送):</span>
              <ul className="mt-0.5 space-y-0.5">
                {q.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-1">
                    <span className="font-mono text-[10.5px] text-accent">{a.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {a.type} · {a.text ? `${a.text.length} 字` : `${a.size} B`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

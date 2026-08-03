import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { computeAuditQueue } from "@/lib/audit-queue";
import type { Evaluation, Question } from "@/types";

export function AuditQueueCard({
  evaluations,
  questions,
  rate,
  onRateChange,
}: {
  evaluations: Evaluation[];
  questions: Question[];
  rate: number;
  onRateChange: (r: number) => void;
}) {
  const r = computeAuditQueue(evaluations, questions, rate);
  const [open, setOpen] = useState(false);
  const titleOf = (qid: string) => questions.find((q) => q.id === qid)?.title ?? qid;
  const [draft, setDraft] = useState(() => String(Math.round(rate * 100)));
  useEffect(() => {
    setDraft(String(Math.round(rate * 100)));
  }, [rate]);

  return (
    <section className="rounded-lg border border-border bg-card p-3 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">抽审队列 · 人工复核</div>
        {r.poolTotal === 0 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">— 暂无可抽审</span>
        ) : r.pendingCount === 0 ? (
          <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-semibold text-success">
            ✅ 抽审已清空 · {r.reviewedCount}/{r.sampledTotal}
          </span>
        ) : (
          <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning">
            待复核 {r.pendingCount} · 已复核 {r.reviewedCount}/{r.sampledTotal}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>抽样比例</span>
        <input
          type="number"
          min={0}
          max={100}
          step={5}
          value={draft}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            if (raw === "") return; // 允许编辑中清空,不立即归零
            const v = Number(raw);
            if (Number.isFinite(v)) onRateChange(Math.max(0, Math.min(100, v)) / 100);
          }}
          onBlur={() => setDraft(String(Math.round(rate * 100)))}
          className="w-14 rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
        />
        <span>% · P0/红线恒 100% 全抽</span>
      </div>

      {r.poolTotal === 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          需要先有被自动判官判过的回答(通过或失败),才能按比例抽样复核。
        </p>
      ) : (
        <>
          <div className="mt-1 text-[11px] text-muted-foreground">
            自动判 {r.poolTotal} 道(通过 {r.autoPassTotal} · 失败 {r.autoFailTotal}) · 抽中{" "}
            {r.sampledTotal} = P0/红线 {r.forcedCount} + 比例抽样 {r.sampledTotal - r.forcedCount} ·
            已复核 {r.reviewedCount}
          </div>
          {r.overturnedCount > 0 && (
            <p className="mt-1.5 text-[11px] text-destructive/90">
              ⚠ 复核中 {r.overturnedCount} 处人工推翻自动判(LLM 判通过被人工否掉=漏判 / LLM 判失败被人工放行=错杀)——建议调 judge prompt 或扩人工样本再放量。
            </p>
          )}
          {r.pending.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                待复核 {r.pending.length} 题
              </button>
              {open && (
                <div className="mt-1 space-y-1">
                  {r.pending.map((it) => (
                    <div
                      key={it.messageId}
                      className="flex items-center gap-2 border-t border-border/60 py-1"
                    >
                      <span className="min-w-0 flex-1 truncate">{titleOf(it.questionId)}</span>
                      <span
                        className={
                          "shrink-0 rounded px-1 text-[10px] " +
                          (it.autoVerdict === "passed"
                            ? "bg-success/15 text-success"
                            : "bg-destructive/15 text-destructive")
                        }
                      >
                        LLM 判{it.autoVerdict === "passed" ? "通过" : "失败"}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{it.severity}</span>
                      {it.forced && (
                        <span className="shrink-0 rounded bg-destructive/15 px-1 text-[10px] text-destructive">
                          P0/红线
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

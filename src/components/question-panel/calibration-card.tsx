import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { computeCalibration, CALIBRATION_THRESHOLD } from "@/lib/calibration";
import type { Evaluation, Question } from "@/types";

export function CalibrationCard({
  evaluations,
  questions,
}: {
  evaluations: Evaluation[];
  questions: Question[];
}) {
  const r = computeCalibration(evaluations);
  const [open, setOpen] = useState(false);
  const titleOf = (qid: string) => questions.find((q) => q.id === qid)?.title ?? qid;
  const mark = (v: "passed" | "failed") => (v === "passed" ? "✅" : "❌");

  return (
    <section className="rounded-lg border border-border bg-card p-3 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">校准 · 人工 vs 自动判官</div>
        {r.n === 0 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">— 样本不足</span>
        ) : (
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold",
              r.gatePass ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
            )}
          >
            {r.gatePass
              ? `✅ 校准通过 · ${r.agreementPct}% ≥ ${CALIBRATION_THRESHOLD}%`
              : `❌ 未通过 · ${r.agreementPct}% < ${CALIBRATION_THRESHOLD}%`}
          </span>
        )}
      </div>

      {r.n === 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          需要「同一份回答既有人工判、又有自动判」的题才能校准。先人工判一批、再对同一批跑自动评分。
        </p>
      ) : (
        <>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {r.n} 道题 人工判 vs 自动判 · 一致 {r.n - r.disagreements.length}/{r.n}
          </div>
          {!r.gatePass && (
            <p className="mt-1.5 text-[11px] text-destructive/90">
              一致率不足 {CALIBRATION_THRESHOLD}%:别盲信自动判官,先调 judge prompt 或扩人工校准样本,再放量批量评分。
            </p>
          )}
          {r.disagreements.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                分歧 {r.disagreements.length} 题
              </button>
              {open && (
                <div className="mt-1 space-y-1">
                  {r.disagreements.map((d) => (
                    <div
                      key={d.messageId}
                      className="flex items-center gap-2 border-t border-border/60 py-1"
                    >
                      <span className="min-w-0 flex-1 truncate">{titleOf(d.questionId)}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        人工 {mark(d.human)} · 自动 {mark(d.auto)}
                      </span>
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

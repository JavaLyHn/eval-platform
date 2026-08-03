import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { lastRoundSteps } from "@/lib/transcript-rounds";
import type { AgentTranscript, TranscriptStep } from "@/types";

const WHITELIST = new Set(["present_options", "panel_show", "preview_file"]);

interface Props {
  transcript: AgentTranscript;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "round"=只看本轮(最后一轮);"full"=整段会话。默认 full。 */
  scope?: "round" | "full";
}

export function TranscriptViewerDialog({
  transcript,
  open,
  onOpenChange,
  scope = "full",
}: Props) {
  const steps =
    scope === "round" ? lastRoundSteps(transcript.steps) : transcript.steps;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(720px,94vw)] flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-[14px]">
            {scope === "round" ? "本轮运行轨迹" : "整段会话运行轨迹"}
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">
            会话 …{transcript.sessionId.slice(-8)} · {steps.length} 步
            {scope === "round" ? "(本轮)" : ""} · 采集于{" "}
            {transcript.fetchedAt.slice(0, 19).replace("T", " ")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <ol className="flex flex-col gap-2.5">
            {steps.map((step, i) => (
              <StepRow key={i} step={step} />
            ))}
            {steps.length === 0 && (
              <li className="text-[12px] text-muted-foreground">（无轨迹步骤）</li>
            )}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepRow({ step }: { step: TranscriptStep }) {
  const [expanded, setExpanded] = useState(false);
  if (step.toolName) {
    const isWhitelist = WHITELIST.has(step.toolName);
    const hasIO = step.toolInput !== undefined || step.output !== undefined;
    return (
      <li
        className={cn(
          "rounded-lg border border-l-[3px] px-3 py-2 text-[12px]",
          step.isError
            ? "border-destructive/40 border-l-destructive bg-destructive/10"
            : "border-accent/40 border-l-accent bg-accent/10",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
              step.isError
                ? "bg-destructive/20 text-destructive"
                : "bg-accent/20 text-accent",
            )}
          >
            🔧 工具调用
          </span>
          <span className="font-mono text-[12.5px] font-bold text-foreground">
            {step.toolName}
          </span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10.5px] font-medium",
              step.isError
                ? "bg-destructive/15 text-destructive"
                : "bg-success/15 text-success",
            )}
          >
            {step.isError ? "✗ 出错" : "✓ 成功"}
          </span>
          {isWhitelist && hasIO ? (
            <button
              className="ml-auto text-[11px] text-accent underline-offset-2 hover:underline"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收起" : "展开入参/出参"}
            </button>
          ) : (
            <span className="ml-auto text-[11px] text-muted-foreground">入参/出参已脱敏</span>
          )}
        </div>
        {step.content && (
          <div
            className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
            title={step.content}
          >
            {step.content}
          </div>
        )}
        {expanded && hasIO && (
          <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-[11px] leading-relaxed">
            {JSON.stringify({ toolInput: step.toolInput, output: step.output }, null, 2)}
          </pre>
        )}
      </li>
    );
  }
  const isAssistant = step.role === "assistant";
  return (
    <li
      className={cn(
        "rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words",
        isAssistant
          ? "border-border bg-card"
          : "border-foreground/10 bg-foreground/[0.04]",
      )}
    >
      <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">
        {isAssistant ? "助手" : step.role === "user" ? "用户" : step.role}
      </div>
      {step.content || <span className="text-muted-foreground">（空）</span>}
    </li>
  );
}

import { Check, Copy, ListTree, Pencil, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { ThinkingPlaceholder } from "./activity-indicator";
import { AgentAvatar } from "./agent-avatar";
import { Avatar } from "@/components/user/user-profile-dialog";
import { TranscriptViewerDialog } from "./transcript-viewer-dialog";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn, formatDuration } from "@/lib/utils";
import { costFromSplit, estimateCostUSD, formatUSD, normalizeTokens } from "@/lib/model-pricing";
import { resolveEmployeeForProfile } from "@/lib/employee-resolve";
import { extractTranscriptImages } from "@/lib/transcript-images";
import { extractTranscriptFiles } from "@/lib/transcript-files";
import { transcriptOutputFiles } from "@/lib/transcript-output-files";
import { stripMediaMarkers } from "@/lib/media-marker";
import { FileCard, FileChip } from "./file-card";
import type { ChatMessage } from "@/types";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // agent 生成的图片不在正文里,而在轨迹的工具产物里 → 抠出来内联展示。
  const transcriptImages = useMemo(
    () => extractTranscriptImages(message.transcript),
    [message.transcript],
  );
  const transcriptFiles = useMemo(
    () => extractTranscriptFiles(message.transcript),
    [message.transcript],
  );
  // Dex 经 delta 数组返回的文件(base64 data URI) —— 读结构化 transcript.files 字段。
  const outputFiles = useMemo(
    () => transcriptOutputFiles(message.transcript),
    [message.transcript],
  );
  // agent 正文里的 `MEDIA:<沙箱路径>` 引用标记行 —— 文件已由上面的文件卡呈现,正文里去掉(仅显示层)。
  // 用户消息保持原样,避免误删用户自己写的内容。
  const displayContent = useMemo(
    () =>
      message.role === "user"
        ? message.content
        : stripMediaMarkers(message.content),
    [message.role, message.content],
  );
  const {
    activityStartedAt,
    agentActivity,
    activeProfileId,
    profiles,
    standardEmployees,
    employeeProfileMap,
    editAndResendMessage,
    retryMessage,
    isStreaming,
    isQuestionInProgress,
    openFilePreview,
    user,
  } = useQAStore();
  // 反查这条消息由哪位员工(Aria/Sam…)作答,页脚显示「员工 · 模型」。
  const bubbleEmployee = resolveEmployeeForProfile(
    message.agentProfileId,
    profiles,
    standardEmployees,
    employeeProfileMap,
  );

  if (message.role === "system") {
    return (
      <div className="my-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 font-mono">
          {message.content}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }

  const isUser = message.role === "user";

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft("");
  };
  const submitEdit = () => {
    const text = draft.trim();
    if (!text || isStreaming || isQuestionInProgress) return;
    editAndResendMessage(message.id, text);
    setEditing(false);
    setDraft("");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div
      className={cn(
        "group flex w-full animate-fade-in gap-2.5",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {message.transcript && (
        <TranscriptViewerDialog
          transcript={message.transcript}
          open={showTranscript}
          onOpenChange={setShowTranscript}
          scope="round"
        />
      )}
      {!isUser && (
        <AgentAvatar
          profileId={message.agentProfileId ?? activeProfileId}
          size={28}
          className="mt-0.5"
        />
      )}
      <div
        className={cn(
          "flex min-w-0 max-w-[88%] flex-col gap-1.5",
          isUser && "items-end",
        )}
      >
        {message.trialTotal && message.trialTotal > 1 && (
          <div className="inline-flex items-center gap-1 text-[10.5px] font-medium text-warning">
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-warning text-[9px] font-semibold text-warning-foreground">
              {(message.trialIndex ?? 0) + 1}
            </span>
            第 {(message.trialIndex ?? 0) + 1} / {message.trialTotal} 次试跑
          </div>
        )}
        {message.turnTotal && message.turnTotal > 1 && (
          <div
            className={cn(
              "inline-flex items-center gap-1 text-[10.5px] font-medium",
              isUser ? "text-muted-foreground" : "text-accent",
            )}
          >
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-foreground text-[9px] font-semibold text-background">
              {(message.turnIndex ?? 0) + 1}
            </span>
            第 {(message.turnIndex ?? 0) + 1} / {message.turnTotal} 步
          </div>
        )}
        {isUser ? (
          editing ? (
            <div className="w-full max-w-full overflow-hidden rounded-2xl border border-border bg-muted px-3 py-2.5 shadow-sm">
              <div className="flex w-full flex-col gap-1.5">
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submitEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                  className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={submitEdit}
                    disabled={!draft.trim() || isStreaming || isQuestionInProgress}
                    className="rounded bg-foreground px-2 py-0.5 text-[11px] font-medium text-background disabled:opacity-50"
                  >
                    重发
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 max-w-full flex-col items-end gap-1.5">
              {/* 图片:独立圆角卡片、无气泡底(参考 Claude);点击看大图 */}
              {message.images && message.images.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {message.images.map((src, i) => (
                    <a
                      key={i}
                      href={src}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-2xl border border-border shadow-sm"
                      title="点击看大图"
                    >
                      <img
                        src={src}
                        alt={`附图 ${i + 1}`}
                        className="max-h-64 max-w-[280px] object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
              {/* 上传的文本文件:芯片(点击下载取回);内联内容已随 prompt 发给 agent */}
              {message.files && message.files.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {message.files.map((f, i) => (
                    <FileChip
                      key={i}
                      name={f.name}
                      onClick={() =>
                        openFilePreview({ filename: f.name, text: f.text })
                      }
                    />
                  ))}
                </div>
              )}
              {/* 文字:浅灰气泡,仅在有文字时出现(纯图消息就只有上面的图卡) */}
              {message.content && (
                <div className="w-fit min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl bg-muted px-3.5 py-2 text-[13.5px] font-medium leading-relaxed text-foreground shadow-sm">
                  {message.content}
                </div>
              )}
            </div>
          )
        ) : (
          <div className="min-w-0 overflow-hidden break-words rounded-xl border border-border bg-card px-3.5 py-2.5 text-[13.5px] leading-relaxed text-card-foreground shadow-sm transition-colors [overflow-wrap:anywhere]">
            {displayContent ? (
              <Markdown fileCards>{displayContent}</Markdown>
            ) : message.isStreaming ? (
              agentActivity === "thinking" ? (
                <ThinkingPlaceholder startedAt={activityStartedAt} />
              ) : (
                <ThinkingDots />
              )
            ) : (
              <span className="text-[13px] italic text-muted-foreground">
                {message.interrupted
                  ? "（智能体在等待你的操作，本轮无文字回复）"
                  : "（本轮无文字回复）"}
              </span>
            )}
            {message.isStreaming && message.content && (
              <span className="ml-0.5 inline-block h-3.5 w-[2px] -mb-0.5 translate-y-0.5 animate-caret-blink bg-foreground" />
            )}
            {/* agent 经工具(generate_image/preview_file)产出的图片:轨迹里抠出的 URL 内联展示;
                加载失败(私有桶/CORS/CSP)不再隐藏,降级成可点开的链接,用户总能拿到图。 */}
            {transcriptImages.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                {transcriptImages.map((src) => (
                  <TranscriptImage key={src} src={src} />
                ))}
              </div>
            )}
            {/* agent 经工具产出的非图片文件(pdf/csv/docx…):从轨迹抠出 URL,出可下载卡片。 */}
            {transcriptFiles.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {transcriptFiles.map((f) => (
                  <FileCard key={f.url} filename={f.filename} url={f.url} />
                ))}
              </div>
            )}
            {/* agent 经 delta 数组返回的文件产物(Dex):文本类内联预览,二进制走 data URI 下载。 */}
            {outputFiles.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {outputFiles.map((f, i) => (
                  <FileCard
                    key={`${f.filename}-${i}`}
                    filename={f.filename}
                    text={f.text}
                    url={f.url}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {!isUser && !message.isStreaming && (
          <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
            {/* 发送时间:常显,排在元信息行最前(时长/tokens/模型之前)。 */}
            <span className="font-mono" title={formatFullTime(message.createdAt)}>
              {formatClock(message.createdAt)}
            </span>
            {message.durationMs != null && (
              <>
                <span className="text-border">·</span>
                <span className="font-mono">
                  {formatDuration(message.durationMs)}
                </span>
              </>
            )}
            {(() => {
              const norm = normalizeTokens(
                {
                  tokens: message.tokens,
                  tokensIn: message.tokensIn,
                  tokensOut: message.tokensOut,
                },
                { estimated: message.tokensEstimated },
              );
              if (norm == null) return null;
              const cost =
                norm.basis === "legacy"
                  ? estimateCostUSD(message.modelVersion, norm.total)
                  : costFromSplit(message.modelVersion, norm.input, norm.output);
              const tip =
                norm.basis === "measured"
                  ? `基于真实 token 用量(输入 ${norm.input} / 输出 ${norm.output})× 官方公开定价。仅供参考,非实际账单。`
                  : norm.basis === "estimated"
                    ? `platform 不回 token;按我方发出的输入(历史+提问)≈${norm.input} + 回复输出≈${norm.output} 估算 × 公开定价。未含 platform 内部系统提示 / skill / 工具开销,故偏低。`
                    : "基于模型官方公开定价 + 70% 输入 / 30% 输出比例的混合估算(仅有总 token、无 in/out 拆分)。仅供参考,非实际账单。";
              return (
                <>
                  <span className="text-border">·</span>
                  <span className="font-mono">{norm.total} tokens</span>
                  {norm.basis !== "legacy" && (
                    <span className="font-mono text-muted-foreground/80">
                      ↑{norm.input} / ↓{norm.output}
                    </span>
                  )}
                  {cost != null && (
                    <>
                      <span className="text-border">·</span>
                      <span className="font-mono" title={tip}>
                        ~{formatUSD(cost)}
                      </span>
                    </>
                  )}
                </>
              );
            })()}
            {(bubbleEmployee || message.modelVersion) && (
              <>
                <span className="text-border">·</span>
                <span className="font-mono">
                  {bubbleEmployee ? `${bubbleEmployee.name} · ` : ""}
                  {message.modelVersion}
                </span>
              </>
            )}
            {message.transcript && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => setShowTranscript(true)}
                aria-label="查看本轮轨迹"
                title="查看本轮运行轨迹(整段会话轨迹在对话顶栏)"
              >
                <ListTree className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(message.transcript ? "" : "ml-auto", "h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100")}
              onClick={handleCopy}
              aria-label="复制回复"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        )}
        {isUser && !editing && (
          <>
            {/* 发送时间:常显,右对齐在气泡下方(操作按钮仍悬停才出现,见下方一行)。 */}
            <span
              className="select-none px-1 font-mono text-[11px] text-muted-foreground"
              title={formatFullTime(message.createdAt)}
            >
              {formatClock(message.createdAt)}
            </span>
            <div className="flex items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6"
                onClick={() => retryMessage(message.id)}
                disabled={isStreaming || isQuestionInProgress}
                aria-label="重试"
                title="重试(用相同输入重新生成,替换旧回答)"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6"
                onClick={startEdit}
                disabled={isStreaming || isQuestionInProgress}
                aria-label="编辑并重发"
                title="编辑并重发(会从这条起重新生成)"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6"
                onClick={handleCopy}
                aria-label="复制"
                title="复制"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </>
        )}
      </div>
      {isUser && <Avatar user={user} size={28} className="mt-0.5 shrink-0" />}
    </div>
  );
}

/** agent 生成的图片:内联展示;加载失败(私有桶/CORS/CSP)降级为可点开的链接,用户总能拿到图。 */
function TranscriptImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-accent hover:bg-secondary"
        title={src}
      >
        🖼 图片(点击在新标签打开)↗
      </a>
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block w-fit">
      <img
        src={src}
        alt="agent 生成的图片"
        loading="lazy"
        className="block h-auto max-h-[28rem] max-w-full rounded-md border border-border object-contain"
        onError={() => setFailed(true)}
      />
    </a>
  );
}

/** ISO 时间 → 消息时间戳:今天只显「HH:MM」(24h),跨天带日期「M月D日 HH:MM」。
 *  new Date(iso) 能把 …Z 与 …+08:00 两种写法都解析成同一时刻,再按查看者本地时区显示。 */
function formatClock(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const hm = d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return sameDay ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  } catch {
    return "";
  }
}

/** ISO 时间 → 完整本地时刻(hover title 用),含年月日时分秒。 */
function formatFullTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "";
  }
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-0.5">
      <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-muted-foreground" />
      <span
        className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-muted-foreground"
        style={{ animationDelay: "0.15s" }}
      />
      <span
        className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-muted-foreground"
        style={{ animationDelay: "0.3s" }}
      />
    </div>
  );
}

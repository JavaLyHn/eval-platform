import { Paperclip, Send, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { FileChip } from "./file-card";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";
import { ACCEPT, MAX_IMAGES, filesToDataUrls } from "@/lib/image-input";
import {
  FILE_ACCEPT,
  MAX_FILES,
  filesToAttachments,
  type AttachedFile,
} from "@/lib/file-input";

/**
 * Composer —— 参照 claude.ai 的输入框:浮起的圆角卡片,文字区在上、
 * 工具条在下(左附件/键盘提示 · 右发送)。支持附加图片(按钮 / 粘贴 / 拖拽),
 * 图片作为 data URL 随本轮发出;视觉能力的 Agent(如 Dex / OpenAI 兼容)才会真正识别。
 * 没配置 Agent 时占位提示「请先配置 agent」并禁用。
 */
export function AgentFooter() {
  const {
    isQuestionInProgressHere,
    sendRawPrompt,
    queueSend,
    activeProfileId,
  } = useQAStore();
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const noAgent = !activeProfileId;
  // 忙碌(本会话正在生成)时不再禁用输入 —— 发送会排队,结束后自动发出。
  const busy = isQuestionInProgressHere;
  // 只有「没配置 agent」才真禁用打字 / 附图 / 发送。
  const disabled = noAgent;
  const canSend =
    (draft.trim().length > 0 || images.length > 0 || files.length > 0) && !noAgent;

  // 自适应高度:随内容增高,到上限(160px)后内部滚动。
  // 下限兜底 40px(= 一行 + 上下内边距):挂载时容器还没量到尺寸、或从隐藏切到可见时,
  // scrollHeight 可能量到 0/偏小,若直接照搬 textarea 会塌到不足一行 → 占位被裁成一条、
  // 下方工具条顶上来叠影(见配套 className 的 min-h-10)。Math.max 保证内联高度不塌。
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 40), 160)}px`;
  }, [draft]);

  // 切换 Agent(或禁用态)时清空未发的图片 / 文件,避免带到别的会话/agent。
  useEffect(() => {
    setImages([]);
    setFiles([]);
  }, [activeProfileId]);

  // 拖入/选择的一批文件:图片走压缩 data URL,文本类走读取内联附件,各自受上限约束。
  const addFiles = async (list: File[]) => {
    if (disabled || list.length === 0) return;
    const imgFiles = list.filter((f) => f.type.startsWith("image/"));
    const textFiles = list.filter((f) => !f.type.startsWith("image/"));
    const room = MAX_IMAGES - images.length;
    if (room > 0 && imgFiles.length) {
      const urls = await filesToDataUrls(imgFiles, room);
      if (urls.length) setImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
    }
    const fileRoom = MAX_FILES - files.length;
    if (fileRoom > 0 && textFiles.length) {
      const { ok } = await filesToAttachments(textFiles, fileRoom);
      if (ok.length) setFiles((prev) => [...prev, ...ok].slice(0, MAX_FILES));
    }
  };

  const handleSend = () => {
    if (!canSend) return;
    // 只发图 / 只发文件时正文可空;sendRawPrompt / queueSend 都已允许。
    const text = draft.trim();
    const imgs = images.length ? images : undefined;
    const atts = files.length ? files : undefined;
    if (busy) {
      // 上一轮还在生成 → 排队(覆盖旧的待发送),结束后自动发出。
      queueSend(text, imgs, atts);
    } else {
      sendRawPrompt(text, imgs, atts);
    }
    setDraft("");
    setImages([]);
    setFiles([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    void addFiles(files);
  };

  return (
    <div className="shrink-0 bg-background px-3 pb-3 pt-2">
      <div
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "rounded-2xl border border-border bg-card shadow-sm transition-shadow",
          "focus-within:shadow-md",
          dragOver && "border-accent/60 ring-2 ring-accent/20",
        )}
      >
        {/* 缩略图预览行 */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {images.map((src, i) => (
              <div
                key={i}
                className="group relative h-16 w-16 overflow-hidden rounded-md border border-border"
              >
                <img src={src} alt={`附图 ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="移除图片"
                  className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 文本文件附件芯片行 */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {files.map((f, i) => (
              <FileChip
                key={i}
                name={f.name}
                onRemove={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}

        <textarea
          id="agent-composer"
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          rows={1}
          placeholder={noAgent ? "请先配置 agent" : "来考考 Agent…(可粘贴 / 拖入图片)"}
          className="block max-h-40 min-h-10 w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 pb-1.5 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
        />

        <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
          {/* 附加图片 */}
          <input
            ref={fileRef}
            type="file"
            accept={`${ACCEPT},${FILE_ACCEPT}`}
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = ""; // 允许重选同一文件
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            aria-label="添加图片 / 文件"
            title="添加图片或文本文件(也可粘贴 / 拖入);图片最多 4 张,文件最多 5 个"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <span className="mr-auto min-w-0 truncate select-none text-[11px] text-muted-foreground">
            {noAgent
              ? ""
              : busy
                ? "上一轮回答中 · 发送将排队,结束后自动发出"
                : "Enter 发送 · Shift+Enter 换行"}
          </span>
          <Button
            size="icon"
            variant="default"
            disabled={!canSend}
            onClick={handleSend}
            aria-label="发送"
            className="h-8 w-8 rounded-full"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

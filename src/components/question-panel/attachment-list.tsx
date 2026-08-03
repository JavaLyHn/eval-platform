import { useState } from "react";
import {
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Paperclip,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { isAcceptedTextFile, MAX_FILE_BYTES, FILE_ACCEPT } from "@/lib/file-input";
import { ACCEPT as IMAGE_ACCEPT } from "@/lib/image-input";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface AttachmentListProps {
  attachments: Attachment[];
  onRemove?: (id: string) => void;
  emptyHint?: string;
  className?: string;
}

export function AttachmentList({
  attachments,
  onRemove,
  emptyHint,
  className,
}: AttachmentListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (attachments.length === 0) {
    return emptyHint ? (
      <p className={cn("text-[11.5px] text-muted-foreground", className)}>
        {emptyHint}
      </p>
    ) : null;
  }

  return (
    <ul className={cn("grid gap-1.5", className)}>
      {attachments.map((a) => {
        const isImage = a.type.startsWith("image/");
        const isMarkdown =
          a.type.includes("markdown") || a.name.toLowerCase().endsWith(".md");
        const isOpen = expanded.has(a.id);
        const canPreview = (isImage && !!a.dataUrl) || a.text != null;
        return (
          <li
            key={a.id}
            className="rounded-md border border-border bg-card text-[12px]"
          >
            <div className="flex items-center gap-2 px-2 py-1.5">
              <button
                type="button"
                onClick={() => toggle(a.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={canPreview ? "点击预览" : "无可预览内容"}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                  {isImage && a.dataUrl ? (
                    <img
                      src={a.dataUrl}
                      alt=""
                      className="h-full w-full rounded object-cover"
                    />
                  ) : isImage ? (
                    <ImageIcon className="h-3.5 w-3.5" />
                  ) : (
                    <FileText className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{a.name}</p>
                  <p className="text-[10.5px] text-muted-foreground">
                    {a.type || "未知类型"} · {formatBytes(a.size)}
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-180",
                  )}
                />
              </button>
              {onRemove && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6"
                  onClick={() => onRemove(a.id)}
                  aria-label="移除附件"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {isOpen && (
              <div className="border-t border-border px-2.5 py-2">
                {isImage && a.dataUrl ? (
                  <img
                    src={a.dataUrl}
                    alt={a.name}
                    className="max-h-64 max-w-full rounded object-contain"
                  />
                ) : a.text != null ? (
                  isMarkdown ? (
                    <div className="max-h-64 overflow-auto break-words">
                      <Markdown>{a.text}</Markdown>
                    </div>
                  ) : (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-foreground/90">
                      <code>{a.text}</code>
                    </pre>
                  )
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    无可预览内容(仅保留了文件元信息;图片超限或非文本类不内联正文)。
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface AttachmentPickerProps {
  onAdd: (attachment: Attachment) => void;
  className?: string;
}

export function AttachmentPicker({
  onAdd,
  className,
}: AttachmentPickerProps) {
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>([]);

  return (
    <div className="grid gap-1">
      <label
        className={cn(
          "inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border bg-card px-2 text-[11px] text-muted-foreground hover:border-foreground/30 hover:bg-surface",
          className,
        )}
      >
        <Paperclip className="h-3 w-3" />
        添加附件
        <input
          type="file"
          multiple
          accept={`${IMAGE_ACCEPT},${FILE_ACCEPT}`}
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            const nextRejected: { name: string; reason: string }[] = [];
            for (const f of files) {
              const att: Attachment = {
                id: `att_${Math.random().toString(36).slice(2, 10)}`,
                name: f.name,
                size: f.size,
                type: f.type,
              };
              const isImage = f.type.startsWith("image/");
              if (isImage) {
                if (f.size >= 1024 * 1024) {
                  nextRejected.push({ name: f.name, reason: "图片超过 1MB" });
                  continue;
                }
                att.dataUrl = await new Promise<string>((resolve) => {
                  const fr = new FileReader();
                  fr.onload = () => resolve(String(fr.result));
                  fr.readAsDataURL(f);
                });
              } else if (isAcceptedTextFile(f)) {
                if (f.size > MAX_FILE_BYTES) {
                  nextRejected.push({ name: f.name, reason: "超过 200KB" });
                  continue;
                }
                try {
                  att.text = await f.text();
                } catch {
                  nextRejected.push({ name: f.name, reason: "读取失败" });
                  continue;
                }
              } else {
                nextRejected.push({ name: f.name, reason: "不支持的类型(仅文本 / 图片)" });
                continue;
              }
              onAdd(att);
            }
            setRejected(nextRejected);
            e.target.value = "";
          }}
        />
      </label>
      {rejected.length > 0 && (
        <p className="text-[10.5px] text-destructive">
          已忽略:
          {rejected.map((r, i) => (
            <span key={`${r.name}_${i}`}>
              {i > 0 && "、"}
              {r.name}({r.reason})
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

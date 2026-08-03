import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  File as FileIcon,
  FileCode,
  FileJson,
  FileText,
  X,
} from "lucide-react";
import { useState } from "react";
import { describeExt, type IconName } from "@/lib/file-types";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn } from "@/lib/utils";

const ICONS: Record<IconName, typeof FileIcon> = {
  code: FileCode,
  markdown: FileText,
  pdf: FileText,
  data: FileJson,
  doc: FileText,
  text: FileText,
  file: FileIcon,
};

type FileCardProps = {
  filename: string;
  /** 内联内容(代码块 / 上传文件):有则可展开预览 + Blob 下载。 */
  text?: string;
  /** 外链(轨迹文件产物,含 PDF):有则「下载」走 href。 */
  url?: string;
  defaultExpanded?: boolean;
};

/** 截图同款文件卡:左类型图标 · 中「文件名 + 类型」· 右「下载」;内联内容可展开预览。 */
export function FileCard({ filename, text, url, defaultExpanded }: FileCardProps) {
  const { openFilePreview } = useQAStore();
  const d = describeExt(filename);
  const Icon = ICONS[d.iconName];
  const [open, setOpen] = useState(!!defaultExpanded);
  const preview = () => openFilePreview({ filename, text, url });

  const downloadBlob = () => {
    const blob = new Blob([text ?? ""], { type: d.mime });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const btn =
    "inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary";

  return (
    <div className="my-2 rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 p-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={preview}
            className="block max-w-full truncate text-left text-[13px] font-medium text-foreground hover:underline"
            title="预览"
          >
            {filename}
          </button>
          <div className="text-[11px] text-muted-foreground">{d.label}</div>
        </div>
        <button
          type="button"
          onClick={preview}
          aria-label="预览"
          title="在右栏预览"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Eye className="h-4 w-4" />
        </button>
        {text != null && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "收起" : "展开"}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
        {url ? (
          <a href={url} download={filename} target="_blank" rel="noreferrer" className={btn}>
            <Download className="h-3.5 w-3.5" />
            下载
          </a>
        ) : (
          <button type="button" onClick={downloadBlob} className={btn}>
            <Download className="h-3.5 w-3.5" />
            下载
          </button>
        )}
      </div>
      {text != null && open && (
        <pre className="max-h-80 overflow-auto border-t border-border bg-muted/30 px-3 py-2 text-[12px] leading-relaxed">
          <code>{text}</code>
        </pre>
      )}
    </div>
  );
}

/** 紧凑文件芯片:输入框待发送 & 用户气泡内联;有 onRemove 显示 ×,有 onDownload 整片可点下载。 */
export function FileChip({
  name,
  onRemove,
  onClick,
}: {
  name: string;
  onRemove?: () => void;
  onClick?: () => void;
}) {
  const d = describeExt(name);
  const Icon = ICONS[d.iconName];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-[11px]",
        onClick && "cursor-pointer hover:bg-secondary",
      )}
      onClick={onClick}
      title={onClick ? `${name} · 点击预览` : name}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="max-w-[160px] truncate text-foreground">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="移除文件"
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

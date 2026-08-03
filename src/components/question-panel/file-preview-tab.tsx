import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import { useQAStore } from "@/hooks/use-qa-store";
import { describeExt } from "@/lib/file-types";
import { previewMode, dataUriToBlob } from "@/lib/file-preview";

/** 右栏「预览」tab:显示点开的聊天文件。md 渲染 / html 沙箱 iframe / 其它源码(可切渲染↔源码)。 */
export function FilePreviewTab() {
  const { previewFile, closePreview } = useQAStore();
  const [showSource, setShowSource] = useState(false);

  // PDF 内嵌:base64 的 data: URI 帧内被现代浏览器限制、沙箱又禁掉内置 PDF 查看器 →
  // 转成 blob URL 用无沙箱 iframe 渲染(http url 直接用);预览关闭 / 切换时回收 URL。
  // hooks 必须在条件 return 之前,故这里从 previewFile? 取值。
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  const pvUrl = previewFile?.url;
  const pvText = previewFile?.text;
  const pvIsPdf = previewFile
    ? describeExt(previewFile.filename).kind === "pdf"
    : false;
  useEffect(() => {
    if (pvText != null || !pvUrl || !pvIsPdf) {
      setPdfSrc(null);
      return;
    }
    if (!pvUrl.startsWith("data:")) {
      setPdfSrc(pvUrl);
      return;
    }
    const blob = dataUriToBlob(pvUrl);
    if (!blob) {
      setPdfSrc(null);
      return;
    }
    const obj = URL.createObjectURL(blob);
    setPdfSrc(obj);
    return () => URL.revokeObjectURL(obj);
  }, [pvUrl, pvText, pvIsPdf]);

  if (!previewFile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-foreground">还没有要预览的文件</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          点聊天里的文件(卡片或上传的附件),内容会在这里显示。
        </p>
      </div>
    );
  }

  const { filename, text, url } = previewFile;
  const d = describeExt(filename);
  const mode = previewMode(filename);
  const isPdf = d.kind === "pdf";
  const canToggle = text != null && (mode === "html" || mode === "markdown");

  const downloadText = () => {
    if (text == null) return;
    const blob = new Blob([text], { type: d.mime });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border pb-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-foreground">{filename}</div>
          <div className="text-[11px] text-muted-foreground">{d.label}</div>
        </div>
        {canToggle && (
          <button
            type="button"
            onClick={() => setShowSource((s) => !s)}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {showSource ? "渲染" : "源码"}
          </button>
        )}
        {text != null ? (
          <button
            type="button"
            onClick={downloadText}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <Download className="h-3.5 w-3.5" />
            下载
          </button>
        ) : url ? (
          <a
            href={url}
            download={filename}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <Download className="h-3.5 w-3.5" />
            下载
          </a>
        ) : null}
        <button
          type="button"
          onClick={closePreview}
          aria-label="关闭预览"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pt-3">
        {text != null ? (
          mode === "html" && !showSource ? (
            <iframe
              title={filename}
              srcDoc={text}
              sandbox=""
              className="h-full min-h-[60vh] w-full rounded-md border border-border bg-white"
            />
          ) : mode === "markdown" && !showSource ? (
            <Markdown>{text}</Markdown>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 text-[12px] leading-relaxed">
              <code>{text}</code>
            </pre>
          )
        ) : url && isPdf ? (
          // PDF:blob URL(见上方 effect)+ 无沙箱 iframe → 浏览器内置查看器渲染。
          <div className="flex h-full min-h-0 flex-col gap-2">
            {pdfSrc ? (
              <iframe
                title={filename}
                src={pdfSrc}
                className="min-h-[60vh] w-full flex-1 rounded-md border border-border bg-white"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">
                PDF 加载中…
              </div>
            )}
            <a
              href={pdfSrc ?? url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[12px] text-accent hover:underline"
            >
              无法内嵌时,点此在新标签打开 / 下载 ↗
            </a>
          </div>
        ) : url ? (
          // 其它二进制(docx/xlsx/zip…):浏览器无法内嵌 → 给干净下载卡,不出破损 iframe。
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-foreground">
              {d.label} 不支持内嵌预览
            </p>
            <a
              href={url}
              download={filename}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <Download className="h-3.5 w-3.5" />
              下载 {filename}
            </a>
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">此文件无可显示内容。</p>
        )}
      </div>
    </div>
  );
}

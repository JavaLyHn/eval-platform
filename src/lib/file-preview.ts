/** 文件预览:待预览文件形状 + 默认预览方式(纯逻辑)。 */

export type PreviewFile = { filename: string; text?: string; url?: string };

function extOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

/** 默认预览方式:html/htm→"html";md/markdown→"markdown";其它→"source"。 */
export function previewMode(filename: string): "html" | "markdown" | "source" {
  const ext = extOf(filename);
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "md" || ext === "markdown") return "markdown";
  return "source";
}

/**
 * `data:` URI → Blob(非 data: 或解析失败 → null)。
 * 用于把 base64 的 PDF 转成 blob URL 内嵌预览:`data:application/pdf` 直接塞进 iframe
 * 在现代浏览器里帧内被限制、且沙箱会禁掉内置 PDF 查看器 → 转 blob URL + 无沙箱 iframe 才能渲染。
 */
export function dataUriToBlob(dataUri: string): Blob | null {
  const m = /^data:([^;,]*)(;base64)?,/.exec(dataUri);
  if (!m) return null;
  const mime = m[1] || "application/octet-stream";
  const body = dataUri.slice(m[0].length);
  try {
    if (m[2]) {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(body)], { type: mime });
  } catch {
    return null;
  }
}

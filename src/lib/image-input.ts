/**
 * 聊天输入框图片附件工具:File → 压缩后的 data URL(base64)。
 *
 * 压到长边 ≤ MAX_EDGE(视觉模型足够用),避免请求体过大(base64 会膨胀 ~33%)。
 * png 保留(可能有透明);其余统一转 jpeg(体积小)。纯浏览器 API,不在服务端跑。
 */

export const MAX_IMAGES = 4;
export const MAX_EDGE = 1568;
export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/** 读单个图片文件 → 压缩后的 data URL。压缩失败/无 canvas 时回退原始 data URL。 */
export async function fileToDataUrl(file: File, maxEdge = MAX_EDGE): Promise<string> {
  const rawUrl = await readAsDataUrl(file);
  try {
    const img = await loadImage(rawUrl);
    const longest = Math.max(img.width, img.height) || 1;
    const scale = Math.min(1, maxEdge / longest);
    // 已经够小且原文件不大 → 不重编码,直接用原始 data URL。
    if (scale >= 1 && file.size < 512 * 1024) return rawUrl;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return rawUrl;
    ctx.drawImage(img, 0, 0, w, h);
    const keepPng = file.type === "image/png";
    return canvas.toDataURL(keepPng ? "image/png" : "image/jpeg", keepPng ? undefined : 0.85);
  } catch {
    return rawUrl;
  }
}

/** 从一批文件里挑出图片、逐个压缩;返回 data URL 数组(受 limit 限制)。 */
export async function filesToDataUrls(files: File[], limit = MAX_IMAGES): Promise<string[]> {
  const imgs = files.filter((f) => f.type.startsWith("image/")).slice(0, limit);
  return Promise.all(imgs.map((f) => fileToDataUrl(f)));
}

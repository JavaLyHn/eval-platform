/** 输入框文本文件附件:读取 → AttachedFile;内联进 prompt。纯浏览器 File API,不在服务端跑。 */

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 200 * 1024;

export type AttachedFile = { name: string; ext: string; mime: string; size: number; text: string };

const TEXT_EXT = new Set([
  "txt","md","markdown","csv","tsv","json","yaml","yml","xml","svg","html","htm","log",
  "js","jsx","ts","tsx","py","go","java","rb","rs","c","cpp","cs","php","sh","bash","sql","css","toml","ini","env","conf",
]);

/** <input accept>:文本类扩展名(图片另由 image-input 的 ACCEPT 负责)。 */
export const FILE_ACCEPT = [...TEXT_EXT].map((e) => `.${e}`).join(",");

function extOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

export function isAcceptedTextFile(file: File): boolean {
  if (file.type.startsWith("image/")) return false;
  if (TEXT_EXT.has(extOf(file.name))) return true;
  return file.type.startsWith("text/") || file.type === "application/json";
}

/** 读一批文件为文本附件;超类型/超大/超量的进 rejected。 */
export async function filesToAttachments(
  files: File[],
  room: number,
): Promise<{ ok: AttachedFile[]; rejected: { name: string; reason: string }[] }> {
  const ok: AttachedFile[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const f of files) {
    if (ok.length >= room) { rejected.push({ name: f.name, reason: "超出数量上限" }); continue; }
    if (!isAcceptedTextFile(f)) { rejected.push({ name: f.name, reason: "不支持的类型(仅文本类)" }); continue; }
    if (f.size > MAX_FILE_BYTES) { rejected.push({ name: f.name, reason: `超过 ${Math.round(MAX_FILE_BYTES / 1024)}KB` }); continue; }
    let text = "";
    try { text = await f.text(); } catch { rejected.push({ name: f.name, reason: "读取失败" }); continue; }
    ok.push({ name: f.name, ext: extOf(f.name) || "txt", mime: f.type || "text/plain", size: f.size, text });
  }
  return { ok, rejected };
}

/** 把附件拼成发给 agent 的内联文本(每个文件一段带文件名围栏)。 */
export function inlineAttachments(files: AttachedFile[]): string {
  if (!files.length) return "";
  return (
    "\n\n" +
    files
      .map((f) => `【附件 ${f.name}】\n\`\`\`${f.ext}\n${f.text}\n\`\`\``)
      .join("\n\n")
  );
}

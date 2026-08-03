import type { Attachment } from "@/types";
import type { AttachedFile } from "@/lib/file-input";

/** 题目附件 → 发送载荷:图片(dataUrl)进 images;文本(text)转 AttachedFile(内联进 prompt)。
 *  无 text 也无 dataUrl(如 pdf 仅元信息)/ 空 → 忽略。发送侧受限于 agent 能收什么。 */
export function attachmentsToSendPayload(
  attachments?: Attachment[],
): { files: AttachedFile[]; images: string[] } {
  const files: AttachedFile[] = [];
  const images: string[] = [];
  for (const a of attachments ?? []) {
    if (a.type?.startsWith("image/") && a.dataUrl) {
      images.push(a.dataUrl);
    } else if (typeof a.text === "string") {
      const ext = a.name.includes(".")
        ? a.name.split(".").pop()!.toLowerCase()
        : "txt";
      files.push({
        name: a.name,
        ext,
        mime: a.type || "text/plain",
        size: a.size,
        text: a.text,
      });
    }
  }
  return { files, images };
}

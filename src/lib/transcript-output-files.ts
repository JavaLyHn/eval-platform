/** gateway(Dex)经 transcript.files 返回的 base64 文件产物 → 预览/下载用 PreviewFile。
 *  与 transcript-files.ts(http-url walk 抽取)互补:那个扫 http URL,这个读结构化 files 字段。 */
import type { AgentTranscript } from "@/types";
import type { PreviewFile } from "@/lib/file-preview";
import { describeExt } from "@/lib/file-types";

// 文本类文件(可解码内联预览);其余(pdf/doc/archive/generic)当二进制走 url 下载。
const TEXT_KINDS = new Set(["markdown", "text", "code", "data"]);

/** data URI → 字符串:优先 base64→UTF-8(正确处理中文);非 base64 走 decodeURIComponent。失败返回 null。 */
function decodeDataUri(dataUri: string): string | null {
  const comma = dataUri.indexOf(",");
  if (comma < 0) return null;
  const meta = dataUri.slice(5, comma); // 去掉 "data:"
  const body = dataUri.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    }
    return decodeURIComponent(body);
  } catch {
    return null;
  }
}

/** 单文件产物 → PreviewFile:文本类给 text(可预览 + Blob 下载);二进制给 url=dataUri(href 下载/iframe)。 */
export function dataUriToFile(filename: string, dataUri: string): PreviewFile {
  if (TEXT_KINDS.has(describeExt(filename).kind)) {
    const text = decodeDataUri(dataUri);
    if (text != null) return { filename, text };
  }
  return { filename, url: dataUri };
}

/** transcript.files → PreviewFile[](空 / undefined / null → [];过滤非 data: 项)。 */
export function transcriptOutputFiles(
  transcript?: AgentTranscript | null,
): PreviewFile[] {
  const files = transcript?.files;
  if (!files?.length) return [];
  return files
    .filter(
      (f) => f && typeof f.dataUri === "string" && f.dataUri.startsWith("data:"),
    )
    .map((f) => dataUriToFile(f.filename || "file", f.dataUri));
}

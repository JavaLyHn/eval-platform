/**
 * Dex 正文里的 `MEDIA:<沙箱路径|URL>` 引用标记行。
 *
 * Dex 用 `MEDIA:/abs/path`(旧沙箱路径约定)在文本里引用产出文件 —— 但这是容器内部
 * 路径、用户根本打不开,且文件本身已由结构化 `data:` URI 另出下载卡(见 transcript-output-files)。
 * 所以这行在正文里纯冗余,显示时去掉。仅影响展示,原始轨迹 / 文件卡不动。
 */

// 整行形如 `MEDIA:/...` 或 `MEDIA:https://...`(允许前导缩进 / 冒号后空格 / 行尾空白)。
// 要求标记后紧跟绝对路径或 URL scheme → 不会误伤正常以 "MEDIA:" 起头的句子。
const MEDIA_MARKER_RE =
  /^[ \t]*MEDIA:[ \t]*(?:\/|[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)\S*[ \t\r]*$/;

/** 去掉正文中的 `MEDIA:` 标记行,并折叠因删行产生的多余空行。无标记则原样返回。 */
export function stripMediaMarkers(text: string): string {
  if (!text || !text.includes("MEDIA:")) return text;
  const lines = text.split("\n");
  const kept = lines.filter((l) => !MEDIA_MARKER_RE.test(l));
  if (kept.length === lines.length) return text;
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // 折叠删行后留下的连续空行
    .replace(/\s+$/, ""); // 去尾部空白
}

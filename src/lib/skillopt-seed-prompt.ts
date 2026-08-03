/** 清洗 LLM 生成结果:去掉整体代码围栏;确保结尾含 SLOW_UPDATE 锚点(无则补,不重复)。 */
export function ensureAnchors(text: string): string {
  let t = text.trim();
  const fence = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1].trim();
  if (!t.includes("<!-- SLOW_UPDATE_START -->")) {
    t += "\n\n<!-- SLOW_UPDATE_START -->\n<!-- SLOW_UPDATE_END -->";
  }
  return t;
}

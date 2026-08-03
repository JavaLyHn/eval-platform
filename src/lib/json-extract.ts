/** 从第一个 `{` 起取最大的括号平衡 JSON 块（字符串感知，处理转义）。找不到返回 null。 */
export function balancedJsonBlock(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 从 `"<arrayKey>": [ ... ]` 里逐个抠出 brace-balanced 的 `{...}` 对象并 JSON.parse。
 * 半截 / 损坏的对象(最后那条还没写完、或某条引号没转义)自动跳过,其余照常返回。
 * 用于流式增量解析与容错恢复(question / candidate 两个数组共用)。
 */
export function extractArrayObjects(raw: string, arrayKey: string): unknown[] {
  const marker = raw.match(new RegExp(`"${arrayKey}"\\s*:\\s*\\[`));
  if (!marker) return [];
  let i = (marker.index ?? 0) + marker[0].length;
  const items: unknown[] = [];
  while (i < raw.length) {
    while (i < raw.length && /[\s,]/.test(raw[i])) i++;
    if (i >= raw.length || raw[i] === "]") break;
    if (raw[i] !== "{") {
      i++;
      continue;
    }
    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (; i < raw.length; i++) {
      const ch = raw[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    const block = raw.slice(start, i);
    try {
      const obj = JSON.parse(block);
      if (obj && typeof obj === "object") items.push(obj);
    } catch {
      /* 跳过半截 / 损坏的对象 */
    }
  }
  return items;
}

/** 把技能文件相对路径按首段分组(references/scripts/templates/data/…),剔除根 SKILL.md。
 *  无斜杠的根级文件归「其它」组。 */
export const OTHER_GROUP = "其它";

export function groupSkillFiles(files: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const f of files) {
    if (f === "SKILL.md") continue;
    const slash = f.indexOf("/");
    const group = slash === -1 ? OTHER_GROUP : f.slice(0, slash);
    (groups[group] ??= []).push(f);
  }
  return groups;
}

export interface FileTag {
  label: string;
  cls: string;
}

const MUTED = "bg-muted text-muted-foreground";
const EXT_TAG: Record<string, FileTag> = {
  ".md": { label: "MD", cls: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" },
  ".py": { label: "PY", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  ".js": { label: "JS", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  ".mjs": { label: "JS", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  ".ts": { label: "JS", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" }, // TypeScript → JS 系徽标
  ".json": { label: "JSON", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  ".yaml": { label: "YAML", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  ".yml": { label: "YAML", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  ".csv": { label: "CSV", cls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300" },
  ".hbs": { label: "HBS", cls: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300" },
  ".sh": { label: "SH", cls: MUTED },
  ".txt": { label: "TXT", cls: MUTED },
};

/** 按文件扩展名给一个彩色类型徽标(label + Tailwind 配色类)。无/未知后缀 → FILE(muted)。 */
export function fileTypeTag(path: string): FileTag {
  const slash = path.lastIndexOf("/");
  const base = path.slice(slash + 1); // 文件名(去目录)
  const dot = base.lastIndexOf(".");
  // dot<=0 同时处理 无后缀(dot===-1)与 隐藏文件(.gitignore → dot===0)
  const ext = dot <= 0 ? "" : base.slice(dot).toLowerCase();
  return EXT_TAG[ext] ?? { label: "FILE", cls: MUTED };
}

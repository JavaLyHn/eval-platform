import { useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { RepoSkillPicker, type RepoSkillSelection } from "@/components/skillopt/repo-skill-picker";
import { repoEmpToStandardId } from "@/lib/agent-repo-compare";
import { ensureAnchors } from "@/lib/skillopt-seed-prompt";
import { INTERN_EMP, loadInternSkillBody } from "@/lib/intern-skill-source";

export interface SeedSkillSelection {
  repoEmp: string;
  standardEmployeeId: string | null;
  skillName: string;
  skillBody: string; // 原始 SKILL.md 正文(未加锚点)。= 所选技能定义,供出题黑盒用;与可编辑的种子正文(onSeedChange)刻意解耦,种子被手动改不影响它。
}

export function SkillBrowser({
  onSeedChange,
  onSkillChange,
}: {
  onSeedChange: (content: string) => void;
  onSkillChange?: (sel: SeedSkillSelection | null) => void;
}) {
  const [sel, setSel] = useState<RepoSkillSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [seedText, setSeedText] = useState("");

  const fetchGen = useRef(0);

  const onPick = async (s: RepoSkillSelection | null) => {
    const gen = ++fetchGen.current;
    setSel(s);
    setErr("");
    if (!s) {
      setSeedText("");
      onSeedChange("");
      onSkillChange?.(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      let body: string | null = null;
      if (s.emp === INTERN_EMP) {
        body = await loadInternSkillBody(s.name);
        if (fetchGen.current !== gen) return;
        if (!body) {
          setErr("取技能正文失败");
          body = null;
        }
      } else {
        const r = await api.agentRepo.skill(s.emp, s.name);
        if (fetchGen.current !== gen) return; // 过期响应丢弃;busy 由最新一代的 finally 清。
        body = r.ok ? r.skill.body : null;
        if (!r.ok) setErr(r.detail || "取技能正文失败");
      }
      if (body != null) {
        const seed = ensureAnchors(body);
        setSeedText(seed);
        onSeedChange(seed);
        onSkillChange?.({
          repoEmp: s.emp,
          standardEmployeeId: s.emp === INTERN_EMP ? INTERN_EMP : repoEmpToStandardId(s.emp),
          skillName: s.name,
          skillBody: body,
        });
      } else {
        setSeedText("");
        onSeedChange("");
        onSkillChange?.(null);
      }
    } catch (e) {
      if (fetchGen.current === gen) {
        setErr((e as Error).message);
        setSeedText("");
        onSeedChange("");
        onSkillChange?.(null);
      }
    } finally {
      if (fetchGen.current === gen) setBusy(false);
    }
  };

  const onEdit = (v: string) => {
    // 仅改种子正文;不动 onSkillChange —— 技能身份(员工/skillBody)由选择器确立,种子手编与它解耦(刻意)。
    setSeedText(v);
    onSeedChange(v);
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <RepoSkillPicker onChange={(s) => void onPick(s)} />

      {sel && (
        <div className="rounded-md border border-border bg-background/40 px-3 py-2">
          <div className="flex items-center gap-2 text-[12px] font-medium">
            {sel.name}
            {sel.version && <span className="text-[11px] text-muted-foreground">· v{sel.version}</span>}
          </div>
          <div className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/80">
            {sel.description || "(无描述)"}
          </div>
        </div>
      )}

      {busy && <div className="text-[11px] text-muted-foreground">取技能正文中…</div>}
      {err && <div className="text-[11px] text-warning">{err}</div>}

      {seedText && (
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">技能正文(可编辑,启动时用它):</div>
          <Textarea value={seedText} onChange={(e) => onEdit(e.target.value)} className="min-h-32 text-[11px] leading-relaxed" />
        </div>
      )}
    </div>
  );
}

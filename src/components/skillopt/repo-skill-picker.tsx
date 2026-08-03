import { useEffect, useRef, useState } from "react";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useQAStore } from "@/hooks/use-qa-store";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { findStandardEmployee } from "@/lib/standard-employees";
import { findExtendedEmployee } from "@/lib/extended-employees";
import { repoEmpToStandardId } from "@/lib/agent-repo-compare";
import { INTERN_EMP, loadInternSkillSummaries } from "@/lib/intern-skill-source";
import type { AgentRepoEmployee, AgentRepoSkillSummary } from "@/lib/agent-repo";

export interface RepoSkillSelection {
  emp: string; // repo 目录名(给 api.agentRepo.skill 用)
  name: string; // 技能名(= s.name)
  description: string;
  version: string | null;
}

/**
 * 「agent-defs repo 员工 → 标准员工 + 该员工技能」二级选择器。
 * 只保留映射到 6 位标准员工的 repo 员工(repoEmpToStandardId 非 null),带头像;
 * 员工 + 技能都选齐时回调 RepoSkillSelection,否则回调 null。
 */
export function RepoSkillPicker({ onChange }: { onChange: (sel: RepoSkillSelection | null) => void }) {
  const { agentRepoVersion } = useQAStore();
  const [employees, setEmployees] = useState<AgentRepoEmployee[]>([]);
  const [empErr, setEmpErr] = useState("");
  const [empLoading, setEmpLoading] = useState(true);

  const [emp, setEmp] = useState("");
  const [skills, setSkills] = useState<AgentRepoSkillSummary[]>([]);
  const [skillErr, setSkillErr] = useState("");
  const [skillLoading, setSkillLoading] = useState(false);
  const [skillName, setSkillName] = useState("");

  useEffect(() => {
    let alive = true;
    api.agentRepo
      .employees()
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          const repoEmps = r.employees.filter((e) => repoEmpToStandardId(e.dir) !== null);
          const intern = findExtendedEmployee(INTERN_EMP);
          setEmployees(
            intern
              ? [...repoEmps, { dir: INTERN_EMP, name: intern.name, skillCount: 0, defFiles: [] }]
              : repoEmps,
          );
        } else setEmpErr(r.detail || "拉取员工失败");
      })
      .catch((e: unknown) => alive && setEmpErr((e as Error).message))
      .finally(() => alive && setEmpLoading(false));
    return () => { alive = false; };
    // 技能源同步后(agentRepoVersion 变)重取员工列表,反映新增/删除/改名。
  }, [agentRepoVersion]);

  const stdOf = (dir: string) => {
    if (dir === INTERN_EMP) return findExtendedEmployee(INTERN_EMP);
    const id = repoEmpToStandardId(dir);
    return id ? findStandardEmployee(id) : undefined;
  };

  const fetchGen = useRef(0);

  const onPickEmployee = (dir: string) => {
    const gen = ++fetchGen.current;
    setEmp(dir);
    setSkillName("");
    setSkills([]);
    setSkillErr("");
    setSkillLoading(true);
    onChange(null);
    const load =
      dir === INTERN_EMP
        ? loadInternSkillSummaries().then((skills) => ({ ok: true as const, skills }))
        : api.agentRepo.employee(dir);
    load
      .then((r) => {
        if (fetchGen.current !== gen) return;
        if (r.ok) setSkills(r.skills);
        else setSkillErr(r.detail || "拉取技能失败");
      })
      .catch((e: unknown) => {
        if (fetchGen.current === gen) setSkillErr((e as Error).message);
      })
      .finally(() => {
        if (fetchGen.current === gen) setSkillLoading(false);
      });
  };

  // 技能源同步后:若已选了某员工,重取其技能(内容可能变了,顺带清掉旧的技能选择)。
  const firstRepoVer = useRef(agentRepoVersion);
  useEffect(() => {
    if (agentRepoVersion === firstRepoVer.current) return; // 跳过首次挂载
    if (emp) onPickEmployee(emp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRepoVersion]);

  const onPickSkill = (name: string) => {
    setSkillName(name);
    const s = skills.find((x) => x.name === name) ?? null;
    onChange(s ? { emp, name: s.name, description: s.description, version: s.version } : null);
  };

  if (empErr) {
    return <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">{empErr}</div>;
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px]">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">员工</span>
        <Select value={emp} onValueChange={onPickEmployee} disabled={empLoading || employees.length === 0}>
          <SelectTrigger className="h-8 w-full sm:w-40">
            {(() => {
              const sel = employees.find((e) => e.dir === emp);
              const std = sel ? stdOf(sel.dir) : undefined;
              return sel ? (
                <div className="flex min-w-0 items-center gap-1.5">
                  {std && <EmployeeAvatar employee={std} size={16} className="shrink-0" />}
                  <span className="truncate">{std?.name ?? sel.name}</span>
                </div>
              ) : (
                <SelectValue placeholder={empLoading ? "加载中…" : "选择员工"} />
              );
            })()}
          </SelectTrigger>
          <SelectContent>
            {employees.map((e) => {
              const std = stdOf(e.dir);
              return (
                <SelectItem key={e.dir} value={e.dir}>
                  <span className="flex items-center gap-1.5">
                    {std && <EmployeeAvatar employee={std} size={16} className="shrink-0" />}
                    {std?.name ?? e.name}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">技能</span>
        <Select value={skillName} onValueChange={onPickSkill} disabled={!emp || skillLoading || skills.length === 0}>
          <SelectTrigger className="h-8 w-full sm:w-52">
            <SelectValue placeholder={!emp ? "先选员工" : skillLoading ? "加载中…" : skills.length === 0 ? "该员工暂无 skill" : "选择技能"} />
          </SelectTrigger>
          <SelectContent>
            {skills.map((s) => (
              <SelectItem key={s.name} value={s.name}>{s.name}{s.version ? ` · v${s.version}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {skillErr && <div className="w-full text-[11px] text-warning">{skillErr}</div>}
    </div>
  );
}

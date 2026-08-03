import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { GitBranch, Boxes, ScrollText, Paperclip } from "lucide-react";

import { HomeButton } from "@/components/home-button";
import { HeaderIconBadge } from "@/components/header-icon-badge";
import { MasterDetailShell, useCloseMasterList } from "@/components/layout/master-detail-shell";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Markdown } from "@/components/ui/markdown";
import { CodeViewer } from "@/components/ui/code-viewer";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AgentRepoEmployee, AgentRepoSkill, AgentRepoSkillSummary } from "@/lib/agent-repo";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { findStandardEmployee } from "@/lib/standard-employees";
import { GATEWAY_EMPLOYEES } from "@/lib/extended-employees";
import { loadBundledSkills } from "@/lib/bundled-skills";
import type { AgentSkill, StandardEmployee } from "@/types";
import { repoEmpToStandardId } from "@/lib/agent-repo-compare";
import { useQAStore } from "@/hooks/use-qa-store";
import { groupSkillFiles, fileTypeTag } from "@/lib/agent-repo-files";

type Selected =
  | { kind: "employee"; dir: string }
  | { kind: "common" }
  | { kind: "bundled"; empId: string };

/**
 * 把 SKILL.md 里的行内代码(如 `scripts/save_draft.py`、`references/x/GUIDE.md`、`copy-quality.md`)
 * 解析成技能包内的真实文件相对路径;解析不到 → null(该代码不可点)。
 * 容忍 sandbox 风格前缀(`.agents/`、`skills/<name>/`、`./`)与 basename-only 引用。
 */
function resolveSkillFile(raw: string, files: string[]): string | null {
  if (!raw || files.length === 0) return null;
  let t = raw.trim().replace(/^[`'"]+|[`'"]+$/g, "").trim();
  t = t.replace(/^\.?\//, "").replace(/^\.agents\//, "").replace(/^workspace\//, "");
  t = t.replace(/^skills\/[^/]+\//, ""); // 砍掉 sandbox 风格 skills/<name>/ 前缀
  if (!t) return null;
  const looksFile =
    /\.(md|mdx|py|mjs|cjs|js|ts|tsx|jsx|json|ya?ml|sh|hbs|csv|txt)$/i.test(t) ||
    /^(scripts|references|templates|data|assets)\/.+/.test(t);
  if (!looksFile) return null;
  if (files.includes(t)) return t; // 1) 精确
  // 2) 路径片段(含 /):唯一以 /t 结尾的文件;或 sandbox 长路径里唯一以 /f 结尾
  if (t.includes("/")) {
    const endsWithT = files.filter((f) => f.endsWith("/" + t));
    if (endsWithT.length === 1) return endsWithT[0];
    const fInT = files.filter((f) => t.endsWith("/" + f));
    if (fInT.length === 1) return fInT[0];
  }
  // 3) 纯文件名:唯一才认(多处同名如 6 个 GUIDE.md → 不可点,避免点错)
  const base = t.slice(t.lastIndexOf("/") + 1);
  const byBase = files.filter((f) => f.slice(f.lastIndexOf("/") + 1) === base);
  return byBase.length === 1 ? byBase[0] : null;
}

/**
 * 文档 Markdown 面板。当给了 basePath + files(技能上下文)时,渲染后把"能解析到真实文件"的
 * 行内代码标成可点击(虚线下划线 + ↗),点击弹窗查看对应文件内容。
 */
function DocMarkdown({
  body,
  basePath,
  files,
  className,
}: {
  body: string;
  basePath?: string;
  files?: string[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<{ path: string; label: string } | null>(null);
  const canLink = !!basePath && !!files && files.length > 0;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // 行内代码:如 `scripts/save_draft.py`
    root.querySelectorAll("code").forEach((el) => {
      const rel =
        canLink && !el.closest("pre") ? resolveSkillFile(el.textContent ?? "", files!) : null;
      if (rel) {
        el.classList.add("file-ref");
        el.setAttribute("data-file", rel);
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        el.setAttribute("title", `查看 ${rel}`);
      } else {
        el.classList.remove("file-ref");
        el.removeAttribute("data-file");
        el.removeAttribute("role");
        el.removeAttribute("tabindex");
      }
    });
    // markdown 链接:如 [..](references/copy-frameworks.md)。相对链接在 SPA 里导航必 404,
    // 一律断掉 href;能解析到技能文件的 → 可点查看,否则灰显"未找到"。绝对外链(http/mailto/#)保持原样。
    root.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") ?? "";
      if (!href || /^([a-z]+:)?\/\//i.test(href) || /^(mailto:|tel:|#)/i.test(href)) return;
      a.removeAttribute("target");
      a.removeAttribute("href"); // 断掉相对导航,杜绝 404
      const rel = canLink
        ? resolveSkillFile(href, files!) ?? resolveSkillFile(a.textContent ?? "", files!)
        : null;
      a.classList.remove("file-ref", "file-ref-missing");
      a.removeAttribute("data-file");
      if (rel) {
        a.classList.add("file-ref");
        a.setAttribute("data-file", rel);
        a.setAttribute("role", "button");
        a.setAttribute("tabindex", "0");
        a.setAttribute("title", `查看 ${rel}`);
      } else {
        a.classList.add("file-ref-missing");
        a.setAttribute("title", `文件未找到:${href}`);
      }
    });
  }, [body, files, canLink]);

  const openFromEvent = (target: EventTarget | null) => {
    const el = (target as Element | null)?.closest?.("code.file-ref, a.file-ref");
    const rel = el?.getAttribute("data-file");
    if (rel && basePath) setViewer({ path: `${basePath}/${rel}`, label: rel });
  };

  return (
    <div className={cn("rounded-lg border border-border bg-muted/25 p-4 sm:p-5", className)}>
      <div
        ref={ref}
        onClick={(e) => openFromEvent(e.target)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && (e.target as Element).closest?.("code.file-ref, a.file-ref")) {
            e.preventDefault();
            openFromEvent(e.target);
          }
        }}
      >
        <Markdown className="prose-doc">{body}</Markdown>
      </div>
      {viewer && (
        <FileViewerDialog
          open
          onOpenChange={(o) => !o && setViewer(null)}
          path={viewer.path}
          label={viewer.label}
          files={files}
          basePath={basePath}
        />
      )}
    </div>
  );
}

/** 受控文件查看弹窗:打开时按需拉取内容;md → DocMarkdown(可继续点引用),代码 → VSCode 风格。 */
function FileViewerDialog({
  open,
  onOpenChange,
  path,
  label,
  files,
  basePath,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  path: string;
  label: string;
  files?: string[];
  basePath?: string;
}) {
  const [body, setBody] = useState<string | null>(null);
  const loadedRef = useRef<string | null>(null);
  const tag = fileTypeTag(path);
  const isMd = /\.mdx?$/i.test(path);
  useEffect(() => {
    if (!open || loadedRef.current === path) return;
    setBody(null);
    let on = true;
    void api.agentRepo
      .file(path)
      .then((r) => { if (on) { setBody(r.ok ? r.body : r.detail ?? "读取失败"); loadedRef.current = path; } })
      .catch(() => { if (on) setBody("读取失败"); });
    return () => { on = false; };
  }, [open, path]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("flex max-h-[85vh] flex-col", isMd ? "max-w-3xl" : "max-w-4xl")}>
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 pr-6 font-mono text-[13px]">
            <span className={cn("shrink-0 rounded px-1 text-[9px] font-bold", tag.cls)}>{tag.label}</span>
            <span className="truncate">{label}</span>
          </DialogTitle>
        </DialogHeader>
        {body === null ? (
          <div className="text-[12px] text-muted-foreground">加载中…</div>
        ) : isMd ? (
          <DocMarkdown body={body} basePath={basePath} files={files} className="min-h-0 flex-1 overflow-auto" />
        ) : (
          <CodeViewer code={body} path={path} className="min-h-0 flex-1 overflow-auto" />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SkillsRepoPage() {
  const { configuredEmployeeIds } = useQAStore();
  const [employees, setEmployees] = useState<AgentRepoEmployee[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [sel, setSel] = useState<Selected>({ kind: "common" });

  // 扩展员工(如 Dex / gateway):技能来自内置数据集(ai-skills-library 解析),
  // 不在后端 agent-defs clone 里 —— 单独一组,数据从前端 bundle 读。
  const bundledEmployees = useMemo(
    () => GATEWAY_EMPLOYEES.filter((e) => configuredEmployeeIds.includes(e.id)),
    [configuredEmployeeIds],
  );
  const [bundledCounts, setBundledCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let on = true;
    void Promise.all(
      bundledEmployees.map(
        async (e) => [e.id, (await loadBundledSkills(e.id)).length] as const,
      ),
    ).then((entries) => {
      if (on) setBundledCounts(Object.fromEntries(entries));
    });
    return () => {
      on = false;
    };
  }, [bundledEmployees]);

  const load = useCallback(async () => {
    try {
      const res = await api.agentRepo.employees();
      if (!res.ok) { setDetail(res.detail ?? "加载失败"); setEmployees([]); return; }
      setDetail(null);
      const mapped = res.employees.filter((e) => repoEmpToStandardId(e.dir) !== null);
      setEmployees(mapped);
    } catch (e) {
      setDetail(e instanceof Error ? e.message : "加载失败");
      setEmployees([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 只显示当前用户已配置 agent 的员工;「共享 common」也仅在配了 agent 时出现。
  const visibleEmployees = employees.filter((e) => {
    const sid = repoEmpToStandardId(e.dir);
    return sid != null && configuredEmployeeIds.includes(sid);
  });
  const hasConfigured = configuredEmployeeIds.length > 0;
  // 选中的员工若已不在可见集(配置变化)→ 回退到「共享 common」。
  const effectiveSel: Selected =
    (sel.kind === "employee" &&
      !visibleEmployees.some((e) => e.dir === sel.dir)) ||
    (sel.kind === "bundled" &&
      !bundledEmployees.some((e) => e.id === sel.empId))
      ? { kind: "common" }
      : sel;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
        <HomeButton />
        <h1 className="inline-flex items-center gap-2 text-[15px] font-semibold">
          <HeaderIconBadge icon={GitBranch} /> 技能
        </h1>
      </header>

      {detail ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-muted-foreground whitespace-pre-wrap">{detail}</div>
      ) : !hasConfigured ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-muted-foreground">
          还没有为任何员工配置 agent。去左侧导航「Agent 管理」配置 agent 后,这里才会显示对应技能。
        </div>
      ) : (
        <MasterDetailShell
          listWidthClass="w-48"
          listClassName="overflow-auto border-r border-border p-2"
          listLabel="选择员工"
          list={
            <SkillsRepoNavList
              visibleEmployees={visibleEmployees}
              bundledEmployees={bundledEmployees}
              bundledCounts={bundledCounts}
              effectiveSel={effectiveSel}
              onSelect={setSel}
            />
          }
        >
          <div className="h-full overflow-auto p-4">
            {effectiveSel.kind === "employee" ? (
              <EmployeeView dir={effectiveSel.dir} />
            ) : effectiveSel.kind === "bundled" ? (
              <BundledView empId={effectiveSel.empId} />
            ) : (
              <CommonView />
            )}
          </div>
        </MasterDetailShell>
      )}
    </div>
  );
}

/**
 * 左侧员工导航(list 插槽内容)。抽成独立组件是为了能在其内部调用
 * `useCloseMasterList()`——手机上点选某员工 / 共享 common 后关抽屉;桌面为 no-op。
 */
function SkillsRepoNavList({
  visibleEmployees,
  bundledEmployees,
  bundledCounts,
  effectiveSel,
  onSelect,
}: {
  visibleEmployees: AgentRepoEmployee[];
  bundledEmployees: StandardEmployee[];
  bundledCounts: Record<string, number>;
  effectiveSel: Selected;
  onSelect: (sel: Selected) => void;
}) {
  const closeList = useCloseMasterList();
  const pick = (sel: Selected) => {
    onSelect(sel);
    closeList();
  };
  return (
    <nav>
      {visibleEmployees.map((e) => {
        const std = repoEmpToStandardId(e.dir);
        const stdEmp = std ? findStandardEmployee(std) : undefined;
        const active = effectiveSel.kind === "employee" && effectiveSel.dir === e.dir;
        return (
          <button type="button" key={e.dir} onClick={() => pick({ kind: "employee", dir: e.dir })}
            className={cn("flex w-full items-center gap-2 rounded border-l-2 px-2 py-1.5 text-left",
              active ? "border-l-accent bg-accent/15 text-foreground" : "border-l-transparent text-muted-foreground hover:text-foreground")}>
            {stdEmp ? <EmployeeAvatar employee={stdEmp} size={20} className="shrink-0" /> : <span className="h-5 w-5 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px]">{e.name}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{std ?? e.dir}</span>
            </span>
            <Badge variant="muted">{e.skillCount}</Badge>
          </button>
        );
      })}
      {bundledEmployees.map((e) => {
        const active =
          effectiveSel.kind === "bundled" && effectiveSel.empId === e.id;
        return (
          <button type="button" key={e.id} onClick={() => pick({ kind: "bundled", empId: e.id })}
            className={cn("flex w-full items-center gap-2 rounded border-l-2 px-2 py-1.5 text-left",
              active ? "border-l-accent bg-accent/15 text-foreground" : "border-l-transparent text-muted-foreground hover:text-foreground")}>
            <EmployeeAvatar employee={e} size={20} className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px]">{e.name}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{e.id} · 内置</span>
            </span>
            {bundledCounts[e.id] != null && <Badge variant="muted">{bundledCounts[e.id]}</Badge>}
          </button>
        );
      })}
      <button type="button" onClick={() => pick({ kind: "common" })}
        className={cn("mt-2 flex w-full items-center gap-1.5 rounded border-l-2 px-2 py-1.5 text-left text-[12.5px]",
          effectiveSel.kind === "common" ? "border-l-accent bg-accent/15 text-foreground" : "border-l-transparent text-muted-foreground hover:text-foreground")}>
        <Boxes className="h-3.5 w-3.5" /> 共享 common
      </button>
    </nav>
  );
}

function EmployeeView({ dir }: { dir: string }) {
  const [data, setData] = useState<{ name: string; defFiles: string[]; skills: AgentRepoSkillSummary[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    setErr(null);
    void api.agentRepo.employee(dir)
      .then((r) => { if (on) { if (r.ok) setData({ name: r.name, defFiles: r.defFiles, skills: r.skills }); else setErr(r.detail ?? "加载失败"); } })
      .catch((e) => { if (on) setErr(e instanceof Error ? e.message : "加载失败"); });
    return () => { on = false; };
  }, [dir]);
  if (err) return <div className="text-[12px] text-destructive">{err}</div>;
  if (!data) return <div className="text-[12px] text-muted-foreground">加载中…</div>;
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-[13px] font-medium">技能 · {data.skills.length}</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {data.skills.map((s) => <SkillCard key={s.name} emp={dir} name={s.name} description={s.description} version={s.version} />)}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-[13px] font-medium">身份 / 人格定义</h2>
        <div className="flex flex-wrap items-center gap-2">
          {data.defFiles.map((f) => <FileChip key={f} path={`workspaces/${dir}/${f}`} label={f} />)}
        </div>
      </section>
    </div>
  );
}

function SkillCard({ emp, name, description, version }: { emp: string; name: string; description: string; version: string | null }) {
  const [skill, setSkill] = useState<AgentRepoSkill | null>(null);
  const [open, setOpen] = useState(false);
  const fetchingRef = useRef(false);
  const openDialog = async () => {
    setOpen(true);
    if (!skill && !fetchingRef.current) {
      fetchingRef.current = true;
      try {
        const r = await api.agentRepo.skill(emp, name);
        if (r.ok) setSkill(r.skill);
      } catch { /* ignore */ }
      fetchingRef.current = false;
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={() => void openDialog()}
        className="flex h-full flex-col rounded-lg border border-border border-l-2 border-l-accent bg-card p-3 text-left shadow-sm transition hover:border-accent/60 hover:shadow-md"
      >
        <div className="flex min-w-0 items-center gap-2 text-[12.5px] font-medium"><span className="min-w-0 flex-1 truncate">{name}</span>{version && <Badge variant="outline">v{version}</Badge>}</div>
        <p className="mt-1 line-clamp-2 text-[11.5px] text-muted-foreground">{description}</p>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex min-w-0 items-center gap-2 pr-6 text-[15px]">
              <HeaderIconBadge icon={ScrollText} />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {version && <Badge variant="outline">v{version}</Badge>}
            </DialogTitle>
            {description && (
              <DialogDescription className="mt-1 rounded-md border-l-[3px] border-accent/40 bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-foreground/70">
                {description}
              </DialogDescription>
            )}
          </DialogHeader>
          {!skill ? (
            <div className="text-[12px] text-muted-foreground">加载中…</div>
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-0.5">
              <DocMarkdown body={skill.body} basePath={`workspaces/${emp}/skills/${name}`} files={skill.files} />
              {Object.entries(groupSkillFiles(skill.files)).length > 0 && (
                <div className="space-y-3 rounded-lg border border-border bg-card p-3">
                  <div className="text-[11px] font-semibold text-foreground/80">附带资源</div>
                  {Object.entries(groupSkillFiles(skill.files)).map(([group, gfiles]) => (
                    <div key={group} className="space-y-1.5">
                      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{group} · {gfiles.length}</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {gfiles.map((rel) => (
                          <FileChip key={rel} path={`workspaces/${emp}/skills/${name}/${rel}`} label={rel.includes("/") ? rel.slice(rel.indexOf("/") + 1) : rel} files={skill.files} basePath={`workspaces/${emp}/skills/${name}`} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FileChip({
  path,
  label,
  files,
  basePath,
}: {
  path: string;
  label: string;
  files?: string[];
  basePath?: string;
}) {
  const [open, setOpen] = useState(false);
  const tag = fileTypeTag(path);
  return (
    <>
      {/* 横排胶囊:参与父级 flex-wrap,排不下自动换行;名字过长省略号 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition hover:border-accent/60 hover:text-foreground"
      >
        <span className={cn("shrink-0 rounded px-1 text-[8.5px] font-bold leading-[1.4]", tag.cls)}>{tag.label}</span>
        <span className="truncate font-mono text-foreground/80">{label}</span>
      </button>
      <FileViewerDialog open={open} onOpenChange={setOpen} path={path} label={label} files={files} basePath={basePath} />
    </>
  );
}

function CommonView() {
  const [data, setData] = useState<{ prompts: { path: string }[]; okrExecutor: AgentRepoSkill } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    setErr(null);
    void api.agentRepo.common()
      .then((r) => { if (on) { if (r.ok) setData({ prompts: r.prompts, okrExecutor: r.okrExecutor }); else setErr(r.detail ?? "加载失败"); } })
      .catch((e) => { if (on) setErr(e instanceof Error ? e.message : "加载失败"); });
    return () => { on = false; };
  }, []);
  if (err) return <div className="text-[12px] text-destructive">{err}</div>;
  if (!data) return <div className="text-[12px] text-muted-foreground">加载中…</div>;
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-[13px] font-medium">通用 prompts(SOUL / RULES / …)</h2>
        <div className="flex flex-wrap items-center gap-2">{data.prompts.map((p) => <FileChip key={p.path} path={p.path} label={p.path.split("/").pop() ?? p.path} />)}</div>
      </section>
      <section>
        <h2 className="mb-2 text-[13px] font-medium">共享技能 · okr-executor {data.okrExecutor.version && `v${data.okrExecutor.version}`}</h2>
        <DocMarkdown body={data.okrExecutor.body} basePath="common/skills/okr-executor" files={data.okrExecutor.files} className="max-h-96 overflow-auto" />
      </section>
    </div>
  );
}

/**
 * 扩展员工(如 Dex)的技能视图 —— 数据来自前端内置 bundle
 * (ai-skills-library 解析,含 SKILL.md 全文),不走后端 agent-repo。
 * 无附带资源文件清单,故正文里的文件引用不可点(纯正文浏览)。
 */
function BundledView({ empId }: { empId: string }) {
  const [skills, setSkills] = useState<AgentSkill[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    setErr(null);
    setSkills(null);
    void loadBundledSkills(empId)
      .then((s) => { if (on) setSkills(s); })
      .catch((e) => { if (on) setErr(e instanceof Error ? e.message : "加载失败"); });
    return () => { on = false; };
  }, [empId]);
  if (err) return <div className="text-[12px] text-destructive">{err}</div>;
  if (!skills) return <div className="text-[12px] text-muted-foreground">加载中…</div>;
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-[13px] font-medium">技能 · {skills.length}</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {skills.map((s) => <BundledSkillCard key={s.id} skill={s} />)}
        </div>
      </section>
    </div>
  );
}

function BundledSkillCard({ skill }: { skill: AgentSkill }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-full flex-col rounded-lg border border-border border-l-2 border-l-accent bg-card p-3 text-left shadow-sm transition hover:border-accent/60 hover:shadow-md"
      >
        <div className="flex min-w-0 items-center gap-2 text-[12.5px] font-medium">
          <span className="min-w-0 flex-1 truncate">{skill.name}</span>
          {skill.category && <Badge variant="outline">{skill.category}</Badge>}
        </div>
        <p className="mt-1 line-clamp-2 text-[11.5px] text-muted-foreground">{skill.description}</p>
        {skill.files && skill.files.length > 0 && (
          <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground/80">
            <Paperclip className="h-2.5 w-2.5" /> {skill.files.length} 个附件
          </span>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex min-w-0 items-center gap-2 pr-6 text-[15px]">
              <HeaderIconBadge icon={ScrollText} />
              <span className="min-w-0 flex-1 truncate">{skill.name}</span>
              {skill.category && <Badge variant="outline">{skill.category}</Badge>}
            </DialogTitle>
            <DialogDescription className="mt-1 rounded-md border-l-[3px] border-accent/40 bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-foreground/70">
              <span className="font-mono">{skill.id}</span>
              {skill.description ? ` — ${skill.description}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-0.5">
            {skill.body ? (
              <DocMarkdown body={skill.body} />
            ) : (
              <p className="text-[12px] text-muted-foreground">(无正文)</p>
            )}
            {skill.files && skill.files.length > 0 && (
              <div className="space-y-3 rounded-lg border border-border bg-card p-3">
                <div className="text-[11px] font-semibold text-foreground/80">
                  附带资源 · {skill.files.length}
                </div>
                {Object.entries(groupSkillFiles(skill.files.map((f) => f.path))).map(
                  ([grp, gpaths]) => (
                    <div key={grp} className="space-y-1.5">
                      <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                        {grp} · {gpaths.length}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {gpaths.map((p) => {
                          const file = skill.files!.find((f) => f.path === p);
                          return file ? (
                            <BundledFileChip key={p} path={p} content={file.content} />
                          ) : null;
                        })}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 内存文件查看器 chip:内容已在 bundle 里,点开直接渲染(md → 文档;其余 → 代码)。 */
function BundledFileChip({ path, content }: { path: string; content: string }) {
  const [open, setOpen] = useState(false);
  const tag = fileTypeTag(path);
  const isMd = /\.mdx?$/i.test(path);
  const label = path.includes("/") ? path.slice(path.indexOf("/") + 1) : path;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition hover:border-accent/60 hover:text-foreground"
      >
        <span className={cn("shrink-0 rounded px-1 text-[8.5px] font-bold leading-[1.4]", tag.cls)}>
          {tag.label}
        </span>
        <span className="truncate font-mono text-foreground/80">{label}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={cn("flex max-h-[85vh] flex-col", isMd ? "max-w-3xl" : "max-w-4xl")}>
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 pr-6 font-mono text-[13px]">
              <span className={cn("shrink-0 rounded px-1 text-[9px] font-bold", tag.cls)}>{tag.label}</span>
              <span className="truncate">{path}</span>
            </DialogTitle>
          </DialogHeader>
          {isMd ? (
            <DocMarkdown body={content} className="min-h-0 flex-1 overflow-auto" />
          ) : (
            <CodeViewer code={content} path={path} className="min-h-0 flex-1 overflow-auto" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

import {
  AlertTriangle,
  Bot,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Hash,
  Loader2,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  Tag,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PromptSourceChip } from "@/components/prompt-source-chip";
import { useQAStore } from "@/hooks/use-qa-store";
import { getProfileKind } from "@/agents/registry";
import { api } from "@/lib/api";
import {
  buildGeneratorPrompt,
  parseGeneratedQuestions,
  buildDraftPrompt,
  parseDrafts,
  buildCriteriaPrompt,
  parseCriteria,
  mergeDraftCriteria,
  applyAdversarialTags,
  buildCells,
  cellTags,
  mapFloorRefsToIds,
  type GeneratedQuestion,
  type GeneratorRequest,
  type GenCell,
  type GenSelection,
} from "@/lib/question-generator";
import { extractArrayObjects } from "@/lib/json-extract";
import { criteriaForQuestion } from "@/lib/question-type";
import { AxisSelect, type AxisOption } from "./axis-select";
import { cn } from "@/lib/utils";
import { standardIdToRepoEmp } from "@/lib/agent-repo-compare";
import { scenariosForEmployee, scenariosForProfession } from "@/lib/employee-scenarios";
import { SEED_SCENARIOS } from "@/lib/gen-dimensions";
import type {
  AgentSkill,
  Difficulty,
  FloorElement,
  QuestionSeverity,
  SampleIntent,
} from "@/types";

/** 技能选项 — 来自 agent-defs 仓(外部源定义);repo 技能名在员工内唯一,充当 id。 */
interface RepoSkillOption {
  id: string;
  name: string;
  description?: string;
  version?: string;
}
import {
  ALL_EMPLOYEES_ID,
  ALL_EMPLOYEES_LABEL,
  STANDARD_EMPLOYEES,
} from "@/lib/standard-employees";
import { GATEWAY_EMPLOYEES } from "@/lib/extended-employees";
import { hasBundledSkills, loadBundledSkills } from "@/lib/bundled-skills";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { Input } from "@/components/ui/input";
import { Users } from "lucide-react";

/** 出题可选员工全集 = 标准线 + Gateway 扩展员工(如 Dex)。 */
const DISPLAY_EMPLOYEES = [...STANDARD_EMPLOYEES, ...GATEWAY_EMPLOYEES];

interface GenerateQuestionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: AgentSkill | null;
}

const DIFF_LABEL: Record<Difficulty, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};
const DIFF_COLOR: Record<Difficulty, string> = {
  easy: "text-success",
  medium: "text-foreground",
  hard: "text-destructive",
};

const MAX_CELLS = 24;
const MAX_TOTAL = 60;

function cellLabel(cell: GenCell, employeeName: (id: string) => string): string {
  const parts = [
    cell.employeeId ? employeeName(cell.employeeId) : null,
    cell.industry,
    cell.profession,
    cell.scenario,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "未指定";
}

export function GenerateQuestionsDialog({
  open,
  onOpenChange,
  skill,
}: GenerateQuestionsDialogProps) {
  const {
    profiles: allProfiles,
    addQuestion,
    addCategory,
    categories,
    lastGeneratorProfileId,
    setLastGeneratorProfileId,
    showNotice,
    runOneShot,
    genDimensions,
    addGenDimension,
    removeGenDimension,
    agentRepoVersion,
    floorElements,
    configuredEmployeeIds,
  } = useQAStore();

  const configuredEmployees = useMemo(
    () => DISPLAY_EMPLOYEES.filter((e) => configuredEmployeeIds.includes(e.id)),
    [configuredEmployeeIds],
  );

  // 出题用 LLM 模型（裸 API），不能用 agent —— agent 是被测对象。
  const profiles = useMemo(
    () => allProfiles.filter((p) => getProfileKind(p.providerId) === "llm"),
    [allProfiles],
  );

  // ---------- Step state ----------
  const [step, setStep] = useState<"config" | "preview">("config");

  // Step 1 inputs
  const [easyCount, setEasyCount] = useState(1);
  const [medCount, setMedCount] = useState(2);
  const [hardCount, setHardCount] = useState(1);
  const [mode, setMode] = useState<"standard" | "adversarial">("standard");
  // 出题方式:拆链(A 题面 + B 判据,推荐)/ 单发(legacy 兜底)。
  const [useChained, setUseChained] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);

  // Step 1 — 出题维度轴（多选,留空＝不约束）。
  // 员工 ↔ 职业互斥:员工档案的职能定位已含职业,二者只取其一;选其一自动清空另一个。
  // 行业轴当前隐藏(保留状态恒为空 = 不约束,buildCells 兼容)。
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [industries] = useState<string[]>([]);
  const [professions, setProfessions] = useState<string[]>([]);
  const [scenarios, setScenarios] = useState<string[]>([]);
  // 新建职业时正在 LLM 生成对应场景 → 期间场景下拉显示「生成中」且禁用,不展示默认场景。
  const [genScenarioBusy, setGenScenarioBusy] = useState(false);

  const handleEmployeeIds = (next: string[]) => {
    // 换员工 → 场景表随身份切换,旧选中的场景对新员工无意义,一并清空。
    if (next[0] !== employeeIds[0]) setScenarios([]);
    setEmployeeIds(next);
    if (next.length > 0) setProfessions([]);
  };
  const handleProfessions = (next: string[]) => {
    setProfessions(next);
    if (next.length > 0) {
      setEmployeeIds([]);
      // 职业变了 → 场景表随之变;把已选场景裁剪到新职业的有效集(保留用户自定义),
      // 剔除对新职业无意义的旧场景,避免悬空选择。
      const seeds = new Set<string>(SEED_SCENARIOS as readonly string[]);
      const valid = new Set<string>([
        ...next.flatMap((p) => scenariosForProfession(p) ?? []),
        ...genDimensions.scenarios.filter((s) => !seeds.has(s)), // 用户自定义场景
      ]);
      setScenarios((prev) => prev.filter((s) => valid.has(s)));
    } else {
      // 清空职业(且员工互斥本就为空)→ 无身份依附,场景不可选,清掉残留选择。
      setScenarios([]);
    }
  };

  // 新增职业 → 用所选 LLM「对应生成」几个业务场景,加进场景维度(best-effort,不阻塞)。
  const generateScenariosForProfession = async (prof: string) => {
    if (!profileId) {
      showNotice({
        kind: "info",
        message: `已添加职业「${prof}」`,
        detail: "选好出题 LLM 后,新增职业会自动为它生成对应场景。",
      });
      return;
    }
    setGenScenarioBusy(true);
    showNotice({ kind: "info", message: `正在为「${prof}」生成对应场景…` });
    try {
      const raw = await runOneShot(
        profileId,
        `为「${prof}」这个职业,列出 5~6 个它在真实工作中常见、适合用来给 AI 员工出测试题的「业务场景」。\n` +
          `要求:每个 4~12 字中文短语(例:黑五大促 / 月度对账 / 客诉处理),贴合该职业日常;每行一个;只输出场景短语本身,不要编号 / 解释 / 多余标点。`,
        { timeoutMs: 60_000 },
      );
      const list = raw
        .split(/\r?\n/)
        .map((s) => s.replace(/^[\s\-*0-9.、)）。]+/, "").trim())
        .filter(Boolean)
        .filter((s) => s.length <= 16)
        .slice(0, 6);
      list.forEach((s) => addGenDimension("scenarios", s));
      showNotice(
        list.length
          ? { kind: "success", message: `已为「${prof}」生成 ${list.length} 个场景` }
          : { kind: "error", message: `「${prof}」场景生成为空`, detail: "可在「场景」里手动「新增取值」。" },
      );
    } catch (e) {
      showNotice({ kind: "error", message: `「${prof}」场景生成失败`, detail: (e as Error)?.message });
    } finally {
      setGenScenarioBusy(false);
    }
  };

  // 维度新增:职业新增时顺带为其生成对应场景;其余轴照常。
  const handleAddDimension = (
    axis: "industries" | "professions" | "scenarios",
    value: string,
  ) => {
    addGenDimension(axis, value);
    if (axis === "professions") void generateScenariosForProfession(value);
  };

  // Skill picker state
  const [skillsByEmp, setSkillsByEmp] = useState<Record<string, RepoSkillOption[]>>({});
  const [skillLoad, setSkillLoad] = useState<Record<string, "loading" | "ok" | "error">>({});
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());

  // 进度按「题」计:done = 已成形题数,total = 本次目标总题数。
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // Step 2 state
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  // Live streaming buffer — appended as the LLM emits chunks. Cleared when
  // generation finishes or the dialog reopens.
  const [streamBuf, setStreamBuf] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 生成中断:点「终止」→ abort 在途调用 + 停止后续 cell + 作废已生成内容。
  const abortRef = useRef<AbortController | null>(null);

  // Initialize LLM selection on open: prefer last-used, otherwise first
  // available LLM profile. Active agent is irrelevant here — agents don't
  // generate questions, only LLM models do.
  useEffect(() => {
    if (!open) return;
    if (profiles.length === 0) {
      setProfileId(null);
      return;
    }
    const fallback =
      lastGeneratorProfileId &&
      profiles.find((p) => p.id === lastGeneratorProfileId)
        ? lastGeneratorProfileId
        : (profiles[0]?.id ?? null);
    setProfileId(fallback);
  }, [open, profiles, lastGeneratorProfileId]);

  // Reset everything when reopened or skill changes.
  useEffect(() => {
    if (!open) return;
    setStep("config");
    setEasyCount(1);
    setMedCount(2);
    setHardCount(1);
    setMode("standard");
    setUseChained(true);
    setDrafts([]);
    setError(null);
    setBusy(false);
    setStreamBuf("");
    setProgress(null);
    const STANDARD_IDS = ["aria", "sam", "dex"];
    // 从技能卡打开:若该 skill 属某扩展员工(如 Dex,skill.id 以员工 id 为前缀)→
    // 预选该员工 + 预选该技能;否则沿用旧逻辑(skill.id 恰为标准员工 id 时预选)。
    const bundledEmp = skill
      ? GATEWAY_EMPLOYEES.find(
          (e) => skill.id === e.id || skill.id.startsWith(e.id + "-"),
        )
      : undefined;
    if (bundledEmp && skill) {
      setEmployeeIds([bundledEmp.id]);
      setSelectedSkillIds(new Set([skill.id]));
    } else {
      setEmployeeIds(skill && STANDARD_IDS.includes(skill.id) ? [skill.id] : []);
      setSelectedSkillIds(new Set());
    }
    setProfessions([]);
    setScenarios([]);
    setSkillsByEmp({});
    setSkillLoad({});
  }, [open, skill?.id]);

  // 对话框关闭时中止任何在途生成(避免后台空跑)。
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  // Lazy-load skills when employees are selected — 来源是 agent-defs 仓
  // (外部源定义,与 /skills-repo、/skills-compare 同口径),不再走 Platform API。
  // 技能源同步后(agentRepoVersion 变)丢弃旧缓存、强制重取,保证显示的是最新仓库内容。
  const lastRepoVerRef = useRef(agentRepoVersion);
  useEffect(() => {
    const repoChanged = lastRepoVerRef.current !== agentRepoVersion;
    if (repoChanged) {
      lastRepoVerRef.current = agentRepoVersion;
      setSkillsByEmp({});
      setSkillLoad({});
    }
    for (const eid of employeeIds) {
      if (!repoChanged && skillLoad[eid]) continue; // 已加载且仓库没变 → 跳过
      // 扩展员工(如 Dex):技能来自前端内置 bundle(ai-skills-library 解析),
      // 不走 agent-repo;id 用完整 skill id,与其它页一致。
      if (hasBundledSkills(eid)) {
        setSkillLoad((s) => ({ ...s, [eid]: "loading" }));
        loadBundledSkills(eid)
          .then((skills) => {
            setSkillsByEmp((m) => ({
              ...m,
              [eid]: skills.map((s) => ({
                id: s.id,
                name: s.name,
                description: s.description,
              })),
            }));
            setSkillLoad((s) => ({ ...s, [eid]: "ok" }));
          })
          .catch(() => setSkillLoad((s) => ({ ...s, [eid]: "error" })));
        continue;
      }
      const dir = standardIdToRepoEmp(eid);
      if (!dir) { setSkillLoad((s) => ({ ...s, [eid]: "error" })); continue; }
      setSkillLoad((s) => ({ ...s, [eid]: "loading" }));
      api.agentRepo.employee(dir)
        .then((res) => {
          if (res.ok) {
            setSkillsByEmp((m) => ({
              ...m,
              // repo 技能无独立 id,技能名在员工内唯一 → 以 name 充当 id
              [eid]: res.skills.map((s) => ({
                id: s.name,
                name: s.name,
                description: s.description,
                version: s.version ?? undefined,
              })),
            }));
            setSkillLoad((s) => ({ ...s, [eid]: "ok" }));
          } else {
            setSkillLoad((s) => ({ ...s, [eid]: "error" }));
          }
        })
        .catch(() => setSkillLoad((s) => ({ ...s, [eid]: "error" })));
    }
  }, [employeeIds, agentRepoVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prune selected skill ids when employee is deselected.
  useEffect(() => {
    setSelectedSkillIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(employeeIds.flatMap((eid) => (skillsByEmp[eid] ?? []).map((s) => s.id)));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [employeeIds, skillsByEmp]);

  // Build skillsByEmployee for buildCells: selected skills per employee.
  const skillsByEmployee = useMemo<Record<string, AgentSkill[]>>(() => {
    const out: Record<string, AgentSkill[]> = {};
    for (const eid of employeeIds) {
      const picked = (skillsByEmp[eid] ?? []).filter((s) => selectedSkillIds.has(s.id));
      if (picked.length) out[eid] = picked.map((s) => ({ id: s.id, name: s.name, description: s.description }));
    }
    return out;
  }, [employeeIds, skillsByEmp, selectedSkillIds]);

  // 技能单选:点选即替换,再点已选项 = 取消。
  const onToggleSkill = (id: string) => {
    setSelectedSkillIds((prev) => (prev.has(id) ? new Set() : new Set([id])));
  };

  const perCell = easyCount + medCount + hardCount;

  // 「场景」下拉来源,优先级:选中员工 → 该员工预置场景;否则选中职业 → 各职业预置场景
  // (合并用户自定义场景,避免丢失);都没选 → 全局通用场景。这样选职业后场景随职业变。
  const scenarioList = useMemo(() => {
    if (employeeIds[0]) {
      return scenariosForEmployee(employeeIds[0]) ?? genDimensions.scenarios;
    }
    if (professions.length > 0) {
      const fromProf = professions.flatMap((p) => scenariosForProfession(p) ?? []);
      // 保留用户自己加的场景(不在内置 SEED 里的 = 自定义),不被职业过滤掉。
      const seeds = new Set<string>(SEED_SCENARIOS as readonly string[]);
      const customs = genDimensions.scenarios.filter((s) => !seeds.has(s));
      // 选了职业就只给该职业的场景(预置 + 自定义);为空也不回退到全局 SEED,
      // 否则新建职业、场景还在生成时会错误地显示一堆默认场景。
      return [...new Set([...fromProf, ...customs])];
    }
    return genDimensions.scenarios;
  }, [employeeIds, professions, genDimensions.scenarios]);

  const selection: GenSelection = { employeeIds, industries, professions, scenarios, skillsByEmployee };
  const cells = buildCells(selection);
  const totalQ = cells.length * perCell;
  const overCells = cells.length > MAX_CELLS;
  const overTotal = totalQ > MAX_TOTAL;
  const canGenerate =
    !!profileId && perCell > 0 && !overCells && !overTotal && !busy;
  // 出题维度:目标员工 / 职业 / 场景 至少选一个才能出题(不再允许留空＝不约束)。
  const hasDimension =
    employeeIds.length > 0 || professions.length > 0 || scenarios.length > 0;

  const employeeName = (id: string) =>
    DISPLAY_EMPLOYEES.find((e) => e.id === id)?.name ?? id;

  // 单格出题请求 — legacy 单发与拆链 A/B 三处共用,所见即所发。
  const reqForCell = (cell: GenCell): GeneratorRequest => {
    const emp = cell.employeeId
      ? DISPLAY_EMPLOYEES.find((e) => e.id === cell.employeeId)
      : undefined;
    return {
      counts: { easy: easyCount, medium: medCount, hard: hardCount },
      mode,
      skill: cell.skill ?? (skill && (!cell.employeeId || skill.id === cell.employeeId) ? skill : undefined),
      employee: emp
        ? {
            name: emp.name,
            title: emp.title,
            coreTasks: emp.coreTasks,
            outOfScope: emp.outOfScope,
          }
        : undefined,
      industry: cell.industry,
      profession: cell.profession,
      scenario: cell.scenario,
      floorTagCandidates: cell.employeeId
        ? floorElements
            .filter((f) => f.employeeId === cell.employeeId)
            .map((f) => ({ id: f.id, title: f.title, isRedLine: f.isRedLine }))
        : undefined,
    };
  };
  const promptForCell = (cell: GenCell): string => buildGeneratorPrompt(reqForCell(cell));

  const handleGenerate = async () => {
    // 未选任何出题维度 → 提醒并拦下(不进入生成)。
    if (!hasDimension) {
      showNotice({
        kind: "info",
        message:
          "请先在上方「出题维度」选择至少一个(目标员工 / 职业 / 场景),再开始生成。",
      });
      return;
    }
    if (!profileId || !canGenerate) return;
    // 已有上一批未导入的题 → 重新生成会覆盖,先确认(防误删刚生成的题)。
    if (
      drafts.length > 0 &&
      !window.confirm(`重新生成会覆盖上一批 ${drafts.length} 道未导入的题,确定?`)
    )
      return;
    setBusy(true);
    setError(null);
    setStreamBuf("");
    setDrafts([]);
    const ac = new AbortController();
    abortRef.current = ac;

    const collected: DraftRow[] = [];
    const failed: string[] = [];

    // 把一格产出的题入队(打标 + 轴 tag);拆链/单发共用。
    const pushQuestions = (
      qs: GeneratedQuestion[],
      ci: number,
      cell: GenCell,
      label: string,
    ) => {
      const tags = cellTags(cell);
      const tagged = mode === "adversarial" ? qs.map(applyAdversarialTags) : qs;
      // 顺序必须与 reqForCell 注入时一致:同样用 floorElements.filter(f => f.employeeId === cell.employeeId),
      // 依赖 store 数组原始顺序,不额外排序。
      const tagCands = cell.employeeId
        ? floorElements
            .filter((f) => f.employeeId === cell.employeeId)
            .map((f) => ({ id: f.id }))
        : [];
      tagged.forEach((q, i) =>
        collected.push({
          id: `g-${ci}-${i}`,
          picked: true,
          targetEmployeeId: cell.employeeId,
          categories: cell.employeeId ? [cell.employeeId] : [],
          cellLabel: label,
          ...q,
          tags: [...(q.tags ?? []), ...tags],
          floorElementIds: mapFloorRefsToIds(q.floorRefs, tagCands),
        }),
      );
    };

    for (let ci = 0; ci < cells.length; ci++) {
      if (ac.signal.aborted) break;
      const cell = cells[ci];
      const label = cellLabel(cell, employeeName);
      setProgress({ done: collected.length, total: totalQ });
      try {
        if (useChained) {
          // ── 拆链 A 段:出题面 + designNote(高温创造性写法在 prompt 里约束)──
          let aBuf = "";
          const rawA = await runOneShot(profileId, buildDraftPrompt(reqForCell(cell)), {
            timeoutMs: 180_000,
            signal: ac.signal,
            onChunk: (delta) => {
              aBuf += delta;
              setStreamBuf((prev) => prev + delta);
              const cur = extractArrayObjects(aBuf, "questions").length;
              setProgress({ done: collected.length + cur, total: totalQ });
            },
          });
          if (ac.signal.aborted) break;
          const drafts = parseDrafts(rawA);
          if (drafts.length === 0) {
            const peek = rawA.trim().slice(0, 100).replace(/\s+/g, " ");
            failed.push(
              `${label}:A 段(题面)未解析出题目${peek ? `(原文开头:${peek}…)` : "(空响应)"}`,
            );
            continue;
          }
          setProgress({ done: collected.length + drafts.length, total: totalQ });
          // ── 拆链 B 段:据题面 + designNote 写判据;按回显题号 i 对齐 ──
          const runB = async () =>
            parseCriteria(
              await runOneShot(
                profileId,
                buildCriteriaPrompt({ employee: reqForCell(cell).employee, drafts, mode }),
                {
                  timeoutMs: 180_000,
                  signal: ac.signal,
                  onChunk: (delta) => setStreamBuf((prev) => prev + delta),
                },
              ),
            );
          let criteria = await runB();
          if (ac.signal.aborted) break;
          // 数量不齐 → 重试 B 一次;仍不齐则按题号尽力对齐 + 标警告(绝不静默错配)。
          if (criteria.length !== drafts.length) {
            criteria = await runB();
            if (ac.signal.aborted) break;
            if (criteria.length !== drafts.length) {
              failed.push(
                `${label}:判据数量与题面不符(题 ${drafts.length} / 判据 ${criteria.length}),已按题号尽力对齐,请在预览里核对判据`,
              );
            }
          }
          pushQuestions(mergeDraftCriteria(drafts, criteria), ci, cell, label);
        } else {
          // ── legacy 单发:一次产出题面 + 判据 ──
          let cellBuf = "";
          const raw = await runOneShot(profileId, promptForCell(cell), {
            timeoutMs: 180_000,
            signal: ac.signal,
            onChunk: (delta) => {
              cellBuf += delta;
              setStreamBuf((prev) => prev + delta);
              const cur = extractArrayObjects(cellBuf, "questions").length;
              setProgress({ done: collected.length + cur, total: totalQ });
            },
          });
          if (ac.signal.aborted) break;
          const parsed = parseGeneratedQuestions(raw);
          if (parsed.length === 0) {
            const peek = raw.trim().slice(0, 100).replace(/\s+/g, " ");
            failed.push(
              `${label}:${peek ? `返回内容未解析出题目(原文开头:${peek}…)` : "模型返回空响应"}`,
            );
            continue;
          }
          pushQuestions(parsed, ci, cell, label);
        }
      } catch (e) {
        if (ac.signal.aborted) break;
        // 真因:LLM 调用本身抛了(超时 180s / 网络 / 鉴权 / 模型 onError)。带上 message。
        const msg = (e as Error)?.message?.trim();
        failed.push(`${label}:${msg || "调用失败(超时或网络异常)"}`);
      }
    }

    // 用户终止 → 作废:已生成内容不进预览、不保存,清空回配置页。
    if (ac.signal.aborted) {
      abortRef.current = null;
      setProgress(null);
      setBusy(false);
      setStreamBuf("");
      setDrafts([]);
      showNotice({ kind: "info", message: "已终止生成,本次生成内容已作废" });
      return;
    }
    abortRef.current = null;

    setProgress(null);
    setLastGeneratorProfileId(profileId);
    setBusy(false);

    if (collected.length === 0) {
      setError(
        `未能生成任何题目${failed.length ? `（失败：${failed.join("、")}）` : ""}，请重试或减少数量。`,
      );
      return;
    }
    if (failed.length > 0) {
      setError(`部分格子失败：${failed.join("、")}（其余已生成，可重试）`);
    }
    setDrafts(collected);
    setStep("preview");
  };

  // ---------- Render ----------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(720px,94vw)] flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-1.5 text-[14px]">
            <Wand2 className="h-3.5 w-3.5 text-foreground/70" />
            生成题目
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">
            {skill ? (
              <>
                目标 skill：
                <span className="ml-1 font-semibold text-foreground">
                  {skill.name}
                </span>
              </>
            ) : (
              "按维度组合生成题目"
            )}
            {step === "config" ? "  · 设置数量与生成器" : "  · 预览并勾选要入库的题目"}
          </DialogDescription>
        </DialogHeader>

        {step === "config" ? (
          <ConfigStep
            skill={skill}
            profiles={profiles}
            profileId={profileId}
            onProfileChange={setProfileId}
            easyCount={easyCount}
            onEasyChange={setEasyCount}
            medCount={medCount}
            onMedChange={setMedCount}
            hardCount={hardCount}
            onHardChange={setHardCount}
            mode={mode}
            onModeChange={setMode}
            chained={useChained}
            onChainedChange={setUseChained}
            busy={busy}
            error={error}
            canGenerate={canGenerate}
            onGenerate={handleGenerate}
            onCancel={() => abortRef.current?.abort()}
            hasDrafts={drafts.length > 0}
            draftCount={drafts.length}
            onBackToPreview={() => setStep("preview")}
            streamBuf={streamBuf}
            employeeOptions={configuredEmployees.map((e) => ({
              value: e.id,
              label: e.name,
              icon: <EmployeeAvatar employee={e} size={16} />,
            }))}
            professionOptions={genDimensions.professions.map((v) => ({ value: v, label: v }))}
            scenarioOptions={scenarioList.map((v) => ({ value: v, label: v }))}
            employeeIds={employeeIds}
            onEmployeeIds={handleEmployeeIds}
            professions={professions}
            onProfessions={handleProfessions}
            scenarios={scenarios}
            onScenarios={setScenarios}
            onAddDimension={handleAddDimension}
            onRemoveDimension={removeGenDimension}
            scenarioLoading={genScenarioBusy}
            cellCount={cells.length}
            perCell={perCell}
            totalQ={totalQ}
            overCells={overCells}
            overTotal={overTotal}
            progress={progress}
            skillsByEmp={skillsByEmp}
            skillLoad={skillLoad}
            selectedSkillIds={selectedSkillIds}
            onToggleSkill={onToggleSkill}
            employeeName={employeeName}
          />
        ) : (
          <PreviewStep
            drafts={drafts}
            setDrafts={setDrafts}
            error={error}
            floorElements={floorElements}
            onBack={() => setStep("config")}
            onImport={() => {
              const picked = drafts.filter((d) => d.picked);
              if (picked.length === 0) return;
              // Make sure every per-draft category exists in the store.
              const newCats = new Set<string>();
              for (const d of picked) {
                for (const c of d.categories) {
                  if (!categories.includes(c)) newCats.add(c);
                }
              }
              for (const c of newCats) addCategory(c);
              for (const d of picked) {
                // 按最终 targetEmployeeId 清孤儿:去掉归属不同员工的 floor 要素 id。
                const cleanedFloorIds = (d.floorElementIds ?? []).filter((id) =>
                  floorElements.some(
                    (f) => f.id === id && f.employeeId === d.targetEmployeeId,
                  ),
                );
                addQuestion({
                  title: d.title,
                  prompt: d.prompt,
                  // 困难题的多轮后续(空则单轮);整段同会话串发、一次评分。
                  ...(d.subPrompts && d.subPrompts.length > 0
                    ? { subPrompts: d.subPrompts }
                    : {}),
                  categories:
                    d.categories.length > 0
                      ? d.categories
                      : skill
                        ? [skill.id]
                        : [],
                  difficulty: d.difficulty,
                  tags: d.tags ?? [],
                  // 题型↔维度对齐:走集中 helper,注入 cleanedFloorIds 派生判分维度。
                  criteria: criteriaForQuestion(
                    { outOfScope: d.outOfScope, floorElementIds: cleanedFloorIds },
                    floorElements,
                  ),
                  agentIds: [],
                  referenceAnswer: d.referenceAnswer,
                  passForm: d.passForm,
                  failForm: d.failForm,
                  severity: d.severity,
                  intent: d.intent,
                  outOfScope: d.outOfScope,
                  groundTruthChecks: d.groundTruthChecks,
                  // 拆链:designNote 浓缩的判分叮嘱落到 judgeFocus,供 LLM 裁判读。
                  ...(d.judgeFocus ? { judgeFocus: d.judgeFocus } : {}),
                  targetEmployeeId: d.targetEmployeeId,
                  floorElementIds: cleanedFloorIds,
                });
              }
              showNotice({
                kind: "success",
                message: `已导入 ${picked.length} 道题到题库`,
              });
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Sub-views ============================ */

function ConfigStep(props: {
  skill: AgentSkill | null;
  profiles: ReturnType<typeof useQAStore>["profiles"];
  profileId: string | null;
  onProfileChange: (id: string) => void;
  easyCount: number;
  onEasyChange: (n: number) => void;
  medCount: number;
  onMedChange: (n: number) => void;
  hardCount: number;
  onHardChange: (n: number) => void;
  mode: "standard" | "adversarial";
  onModeChange: (m: "standard" | "adversarial") => void;
  chained: boolean;
  onChainedChange: (v: boolean) => void;
  busy: boolean;
  error: string | null;
  canGenerate: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  /** 已有上一批生成结果(未清空)→ 显示「返回刚生成结果」,避免回设置后丢失。 */
  hasDrafts: boolean;
  draftCount: number;
  onBackToPreview: () => void;
  streamBuf: string;
  employeeOptions: AxisOption[];
  professionOptions: AxisOption[];
  scenarioOptions: AxisOption[];
  employeeIds: string[];
  onEmployeeIds: (next: string[]) => void;
  professions: string[];
  onProfessions: (next: string[]) => void;
  scenarios: string[];
  onScenarios: (next: string[]) => void;
  onAddDimension: (
    axis: "industries" | "professions" | "scenarios",
    value: string,
  ) => void;
  onRemoveDimension: (
    axis: "industries" | "professions" | "scenarios",
    value: string,
  ) => void;
  /** 正在为新职业生成场景 → 场景下拉显示「生成中」且禁用。 */
  scenarioLoading?: boolean;
  cellCount: number;
  perCell: number;
  totalQ: number;
  overCells: boolean;
  overTotal: boolean;
  progress: { done: number; total: number } | null;
  skillsByEmp: Record<string, RepoSkillOption[]>;
  skillLoad: Record<string, "loading" | "ok" | "error">;
  selectedSkillIds: Set<string>;
  onToggleSkill: (id: string) => void;
  employeeName: (id: string) => string;
}) {
  // 至少选一个出题维度(目标员工 / 职业 / 场景)才能出题。
  const hasDimension =
    props.employeeIds.length > 0 ||
    props.professions.length > 0 ||
    props.scenarios.length > 0;
  // 场景依附于身份:必须先选目标员工或职业,场景才有意义、才可选。
  const scenarioReady =
    props.employeeIds.length > 0 || props.professions.length > 0;
  // 技能太多(Aria 28 个)→ 默认折叠,只显示已选的;点「展开」才铺全部。
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const totalSkills = props.employeeIds.reduce(
    (n, eid) => n + (props.skillsByEmp[eid]?.length ?? 0),
    0,
  );
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 px-4 py-3.5">
          {/* Skill summary card — 仅在以某个 skill 预填时展示 */}
          {props.skill && (
            <section className="rounded-lg border border-border bg-card/60 px-3 py-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-foreground/60" />
                <span className="text-[13px] font-semibold text-foreground">
                  {props.skill.name}
                </span>
                {props.skill.category && (
                  <Badge variant="muted" className="text-[10px]">
                    {props.skill.category}
                  </Badge>
                )}
              </div>
              {props.skill.description && (
                <p className="mt-1 line-clamp-2 text-[11.5px] text-muted-foreground">
                  {props.skill.description}
                </p>
              )}
            </section>
          )}

          {/* ① 出题维度 —— 核心、必选(下拉单选;员工 ↔ 职业互斥) */}
          <section className="space-y-2.5">
            <SectionTitle
              icon={<Users className="h-3.5 w-3.5" />}
              title="出题维度"
              hint="每项单选,至少选一个才能出题"
              hintTone={hasDimension ? "muted" : "warning"}
              required
            />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {props.professions.length === 0 && (
                <AxisSelect
                  label="目标员工"
                  options={props.employeeOptions}
                  selected={props.employeeIds}
                  onChange={props.onEmployeeIds}
                  placeholder="未指定"
                />
              )}
              {props.employeeIds.length === 0 && (
                <AxisSelect
                  label="职业"
                  options={props.professionOptions}
                  selected={props.professions}
                  onChange={props.onProfessions}
                  onAddNew={(v) => props.onAddDimension("professions", v)}
                  onRemove={(v) => props.onRemoveDimension("professions", v)}
                />
              )}
              <AxisSelect
                label="场景"
                options={props.scenarioOptions}
                selected={props.scenarios}
                onChange={props.onScenarios}
                onAddNew={(v) => props.onAddDimension("scenarios", v)}
                loading={props.scenarioLoading}
                loadingLabel="生成场景中…"
                disabled={!scenarioReady}
                placeholder={scenarioReady ? "未指定" : "请先选择目标员工/职业"}
              />
            </div>
            {props.employeeIds.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                已选目标员工 — 职业由员工档案的职能定位决定，无需另选。
              </p>
            )}
            {props.professions.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                已选职业 — 与目标员工互斥；要按员工出题请先清空职业。
              </p>
            )}
            {/* 仅在超限时给红色警告(题数正常时不再常驻显示「合计 N 题」)。 */}
            {(props.overCells || props.overTotal) && (
              <p className="flex items-start gap-1.5 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {props.overCells
                  ? `维度组合 ${props.cellCount} 个,超过上限 ${MAX_CELLS},请减少所选维度`
                  : `合计 ${props.totalQ} 题超过上限 ${MAX_TOTAL},请减少题数`}
              </p>
            )}
          </section>

          {/* ② 技能选择器（按所选员工，可选;技能多→默认折叠） */}
          {props.employeeIds.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <SectionTitle icon={<Tag className="h-3.5 w-3.5" />} title="技能" />
                {totalSkills > 0 && (
                  <button
                    type="button"
                    onClick={() => setSkillsExpanded((v) => !v)}
                    className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-accent hover:underline"
                  >
                    {skillsExpanded ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" /> 收起
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" /> 展开 {totalSkills} 个
                      </>
                    )}
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {props.employeeIds.map((eid) => {
                  const state = props.skillLoad[eid];
                  const skills = props.skillsByEmp[eid] ?? [];
                  return (
                    <div key={eid} className="rounded-md border border-border bg-card/40 px-3 py-2">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                        <span>{props.employeeName(eid)}</span>
                        {state === "ok" && (
                          <span className="font-normal text-muted-foreground">({skills.length})</span>
                        )}
                      </div>
                      {state === "loading" && (
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          加载中…
                        </div>
                      )}
                      {state === "error" && (
                        <div className="text-[11px] text-muted-foreground/70">
                          仓库无该员工目录或拉取失败(检查后端 agent-repo 配置)
                        </div>
                      )}
                      {state === "ok" && skills.length === 0 && (
                        <div className="text-[11px] text-muted-foreground/70">
                          该员工暂无技能
                        </div>
                      )}
                      {state === "ok" && skills.length > 0 && (() => {
                        // 收起时只显示已选的 chip(没选则给一行提示);展开时铺全部。
                        const shown = skillsExpanded
                          ? skills
                          : skills.filter((s) => props.selectedSkillIds.has(s.id));
                        if (shown.length === 0) {
                          return null; // 收起且未选技能时不显示「未选」字样
                        }
                        return (
                          <div className="flex flex-wrap gap-1.5">
                            {shown.map((s) => {
                              const picked = props.selectedSkillIds.has(s.id);
                              return (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => props.onToggleSkill(s.id)}
                                  title={s.description}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors",
                                    picked
                                      ? "border-foreground/60 bg-foreground/10 font-medium text-foreground"
                                      : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                                  )}
                                >
                                  {s.name}
                                  {s.version && (
                                    <span className="font-mono text-[9.5px] opacity-60">[v{s.version}]</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ③ 出题数量 — 按难度步进调节(− / +) */}
          <section className="space-y-2">
            <SectionTitle icon={<Hash className="h-3.5 w-3.5" />} title="出题数量" hint="按难度" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <CountStepper
                label="简单"
                tone="text-success"
                value={props.easyCount}
                onChange={props.onEasyChange}
              />
              <CountStepper
                label="中等"
                tone="text-foreground"
                value={props.medCount}
                onChange={props.onMedChange}
              />
              <CountStepper
                label="困难"
                tone="text-destructive"
                value={props.hardCount}
                onChange={props.onHardChange}
              />
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              共{" "}
              <span className="font-mono font-semibold text-foreground">
                {props.perCell}
              </span>{" "}
              道
              {props.perCell === 0 && (
                <span className="ml-1 text-destructive">— 至少调到 1 道才能生成</span>
              )}
            </div>
          </section>

          {/* ④ 出题选项 —— 模式 + 方式两个开关收成一组紧凑行 */}
          <section className="space-y-2">
            <SectionTitle icon={<SlidersHorizontal className="h-3.5 w-3.5" />} title="出题选项" />
            <div className="space-y-1.5">
              <ToggleRow
                checked={props.chained}
                onChange={props.onChainedChange}
                label="拆链出题"
                tag="推荐"
                desc="题面 + 判据分两段生成,各自更专注;取消勾选 = 旧的「单发」一次出全(兜底)。"
              />
              <ToggleRow
                checked={props.mode === "adversarial"}
                onChange={(v) => props.onModeChange(v ? "adversarial" : "standard")}
                label="出「故意找茬」的题"
                desc="挖坑 / 套话 / 提越权或不归它管的要求,看它会不会上当;勾上后这批按对抗思路出,自动计入「边界识别」。"
              />
            </div>
            {props.chained ? (
              <div className="space-y-1">
                <PromptSourceChip promptKey="ai-question-gen-draft" />
                <PromptSourceChip promptKey="ai-question-gen-criteria" />
              </div>
            ) : (
              <PromptSourceChip promptKey="ai-question-gen" />
            )}
          </section>

          {/* ⑤ 出题模型 */}
          <section className="space-y-2">
            <SectionTitle icon={<Bot className="h-3.5 w-3.5" />} title="出题模型" hint="用哪个 LLM 出题" />
            <Select
              value={props.profileId ?? ""}
              onValueChange={props.onProfileChange}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="选择 LLM 模型" />
              </SelectTrigger>
              <SelectContent>
                {props.profiles.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                    暂无 LLM 模型，请先在左侧导航「LLM 模型」里添加
                  </div>
                ) : (
                  props.profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">
                        ({p.providerId})
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </section>

          {props.error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{props.error}</span>
            </div>
          )}

          {props.progress && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-1.5 text-[11.5px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin text-accent" />
              正在生成 第{" "}
              <span className="font-mono font-medium text-foreground">
                {Math.min(props.progress.done + 1, props.progress.total)}
              </span>
              /{props.progress.total} 题…
            </div>
          )}

          {(props.busy || props.streamBuf.length > 0) && (
            <StreamOutputPanel busy={props.busy} text={props.streamBuf} />
          )}
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
        {/* 左:已有上一批结果时,提供返回入口 —— 回设置后不丢题 */}
        <div>
          {props.hasDrafts && !props.busy && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={props.onBackToPreview}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              返回刚生成的 {props.draftCount} 道
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {props.busy && (
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={props.onCancel}
            >
              <Square className="h-3.5 w-3.5" />
              终止
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            disabled={!props.canGenerate}
            onClick={props.onGenerate}
            title={props.hasDrafts ? "重新生成会覆盖上一批未导入的题" : undefined}
          >
            {props.busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bot className="h-3.5 w-3.5" />
            )}
            {props.busy ? "正在生成…" : props.hasDrafts ? "重新生成" : "开始生成"}
          </Button>
        </div>
      </footer>
    </>
  );
}

/**
 * Live preview of the LLM stream while it's generating. Auto-scrolls to the
 * bottom on each chunk so the latest text is always visible. Hides itself
 * after the run finishes — the preview step replaces it.
 */
function StreamOutputPanel({ busy, text }: { busy: boolean; text: string }) {
  const ref = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return (
    <section className="rounded-md border border-border bg-card/40">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin text-accent" />
        ) : (
          <Bot className="h-3 w-3" />
        )}
        <span>
          LLM 输出{busy && "中"}{" "}
          <span className="font-mono tabular-nums">
            {text.length.toLocaleString()} 字
          </span>
        </span>
      </div>
      <pre
        ref={ref}
        className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/80"
      >
        {text || "等待 LLM 开始输出…"}
      </pre>
    </section>
  );
}

interface DraftRow extends GeneratedQuestion {
  id: string;
  picked: boolean;
  /** Auto-mapped from skill.id when applicable; user-editable. */
  targetEmployeeId?: string;
  /** Pre-filled with [skill.id]; user can add/remove. */
  categories: string[];
  /** 该题来自哪个矩阵格子（用于预览分组展示）。 */
  cellLabel: string;
  /** 自动回标 / 用户在预览改过的 floor 要素 id;导入时落到 Question.floorElementIds。 */
  floorElementIds?: string[];
}

function PreviewStep({
  drafts,
  setDrafts,
  error,
  onBack,
  onImport,
  floorElements,
}: {
  drafts: DraftRow[];
  setDrafts: (updater: (prev: DraftRow[]) => DraftRow[]) => void;
  error: string | null;
  onBack: () => void;
  onImport: () => void;
  floorElements: FloorElement[];
}) {
  const pickedCount = drafts.filter((d) => d.picked).length;
  const allPicked = pickedCount === drafts.length && drafts.length > 0;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-2 px-4 py-3">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive">
              {error}
            </div>
          )}
          {drafts.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-muted-foreground">
              没有题目可预览
            </div>
          ) : (
            (() => {
              const groups = new Map<string, { idx: number; d: DraftRow }[]>();
              drafts.forEach((d, idx) => {
                const arr = groups.get(d.cellLabel) ?? [];
                arr.push({ idx, d });
                groups.set(d.cellLabel, arr);
              });
              return [...groups.entries()].map(([label, items]) => (
                <div key={label} className="space-y-2">
                  <div className="flex items-center gap-2 pt-1 text-[11px] font-medium text-muted-foreground">
                    <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-foreground">{label}</span>
                    <span>{items.length} 道</span>
                  </div>
                  {items.map(({ idx, d }) => (
                    <DraftCard
                      key={d.id}
                      draft={d}
                      idx={idx}
                      floorElements={floorElements}
                      onChange={(patch) =>
                        setDrafts((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
                      }
                      onRemove={() => setDrafts((prev) => prev.filter((_, i) => i !== idx))}
                    />
                  ))}
                </div>
              ));
            })()
          )}
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={onBack}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            回到设置
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDrafts((prev) =>
                prev.map((p) => ({ ...p, picked: !allPicked })),
              )
            }
            disabled={drafts.length === 0}
          >
            {allPicked ? "全部取消" : "全选"}
          </Button>
        </div>
        <Button
          variant="default"
          size="sm"
          disabled={pickedCount === 0}
          onClick={onImport}
        >
          导入 {pickedCount} 道到题库
        </Button>
      </footer>
    </>
  );
}

/**
 * Editor card for one AI-generated draft. Field set matches QuestionFormDialog
 * (title / prompt / 目标员工 / 分类 / 难度 / 严重度 / 意图 /
 * Pass / Fail / 参考答案) so users can review + tighten LLM output before
 * committing to the library. Wrapped in a collapsible <details> so 多稿
 * preview stays scannable.
 */
function DraftCard({
  draft,
  idx,
  floorElements,
  onChange,
  onRemove,
}: {
  draft: DraftRow;
  idx: number;
  floorElements: FloorElement[];
  onChange: (patch: Partial<DraftRow>) => void;
  onRemove: () => void;
}) {
  const { configuredEmployeeIds } = useQAStore();
  const configuredEmployees = useMemo(
    () => DISPLAY_EMPLOYEES.filter((e) => configuredEmployeeIds.includes(e.id)),
    [configuredEmployeeIds],
  );
  return (
    <details
      open
      className={cn(
        "group rounded-lg border bg-card transition-colors",
        draft.picked ? "border-foreground/30" : "border-border opacity-60",
      )}
    >
      <summary className="flex cursor-pointer items-start gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange({ picked: !draft.picked });
          }}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={draft.picked ? "取消选中" : "选中"}
        >
          {draft.picked ? (
            <CheckSquare className="h-4 w-4 text-foreground" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10.5px] text-muted-foreground">
              #{idx + 1}
            </span>
            <input
              value={draft.title}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="标题"
              className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-foreground outline-none focus:outline-1 focus:outline-foreground/30"
            />
            <Badge variant="muted" className={cn("shrink-0 text-[10px]", DIFF_COLOR[draft.difficulty])}>
              {DIFF_LABEL[draft.difficulty]}
            </Badge>
            {draft.severity && (
              <Badge variant="muted" className="shrink-0 text-[10px]">
                {draft.severity}
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          aria-label="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </summary>

      <div className="space-y-2.5 border-t border-border/60 px-3 py-3 text-[11.5px]">
        {/* prompt(困难题=第1轮开场) */}
        <CardField label={(draft.subPrompts?.length ?? 0) > 0 ? "第 1 轮（开场 prompt）" : "题目内容（prompt）"}>
          <Textarea
            value={draft.prompt}
            onChange={(e) => onChange({ prompt: e.target.value })}
            className="min-h-[64px] text-[12px]"
          />
        </CardField>

        {/* 多轮:后续轮(困难题) —— 整段同会话串发、一次评分 */}
        {(draft.subPrompts?.length ?? 0) > 0 && (
          <CardField label={`后续轮（多轮对话 · 共 ${(draft.subPrompts?.length ?? 0) + 1} 轮）`}>
            <div className="space-y-1.5">
              {(draft.subPrompts ?? []).map((sp, si) => (
                <div key={si} className="flex items-start gap-1.5">
                  <span className="mt-2 shrink-0 font-mono text-[10px] text-muted-foreground">
                    第 {si + 2} 轮
                  </span>
                  <Textarea
                    value={sp}
                    onChange={(e) => {
                      const next = [...(draft.subPrompts ?? [])];
                      next[si] = e.target.value;
                      onChange({ subPrompts: next });
                    }}
                    className="min-h-[40px] flex-1 text-[12px]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mt-1 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      onChange({
                        subPrompts: (draft.subPrompts ?? []).filter((_, i) => i !== si),
                      })
                    }
                    aria-label="删除这一轮"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-[11px]"
                onClick={() =>
                  onChange({ subPrompts: [...(draft.subPrompts ?? []), ""] })
                }
              >
                <Plus className="h-3 w-3" /> 加一轮
              </Button>
            </div>
          </CardField>
        )}

        {/* 轴 tags（只读） */}
        {draft.tags && draft.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {draft.tags.map((t) => (
              <Badge key={t} variant="muted" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        )}

        {/* row 1: employee / categories / difficulty */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
          <CardField label="目标员工">
            <Select
              value={draft.targetEmployeeId ?? "_none_"}
              onValueChange={(v) =>
                onChange({ targetEmployeeId: v === "_none_" ? undefined : v })
              }
            >
              <SelectTrigger className="h-8 text-[11.5px]">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none_">— 未指定 —</SelectItem>
                <SelectItem value={ALL_EMPLOYEES_ID}>
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3 w-3" />
                    {ALL_EMPLOYEES_LABEL}
                  </span>
                </SelectItem>
                {configuredEmployees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    <span className="inline-flex items-center gap-1.5">
                      <EmployeeAvatar employee={e} size={14} />
                      {e.name}
                    </span>
                  </SelectItem>
                ))}
                {configuredEmployees.length === 0 && (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                    还没配置 agent，先去「员工」里关联
                  </div>
                )}
              </SelectContent>
            </Select>
          </CardField>
          <CardField label="分类（逗号分隔）">
            <Input
              value={draft.categories.join(", ")}
              onChange={(e) =>
                onChange({
                  categories: e.target.value
                    .split(/[,，、]/)
                    .map((c) => c.trim())
                    .filter(Boolean),
                })
              }
              className="h-8 text-[11.5px]"
              placeholder="aria, 营销策略"
            />
          </CardField>
          <CardField label="难度">
            <Select
              value={draft.difficulty}
              onValueChange={(v) => onChange({ difficulty: v as Difficulty })}
            >
              <SelectTrigger className="h-8 text-[11.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">{DIFF_LABEL.easy}</SelectItem>
                <SelectItem value="medium">{DIFF_LABEL.medium}</SelectItem>
                <SelectItem value="hard">{DIFF_LABEL.hard}</SelectItem>
              </SelectContent>
            </Select>
          </CardField>
        </div>

        {/* row 2: severity / intent */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <CardField label="严重度">
            <Select
              value={draft.severity ?? "_none_"}
              onValueChange={(v) =>
                onChange({ severity: v === "_none_" ? undefined : (v as QuestionSeverity) })
              }
            >
              <SelectTrigger className="h-8 text-[11.5px]">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none_">— 未指定 —</SelectItem>
                <SelectItem value="P0">P0 — 影响核心</SelectItem>
                <SelectItem value="P1">P1 — 影响差异化</SelectItem>
                <SelectItem value="P2">P2 — 细节</SelectItem>
              </SelectContent>
            </Select>
          </CardField>
          <CardField label="样本意图">
            <Select
              value={draft.intent ?? "_none_"}
              onValueChange={(v) =>
                onChange({ intent: v === "_none_" ? undefined : (v as SampleIntent) })
              }
            >
              <SelectTrigger className="h-8 text-[11.5px]">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none_">— 未指定 —</SelectItem>
                <SelectItem value="typical">typical 典型</SelectItem>
                <SelectItem value="boundary">boundary 临近边界</SelectItem>
                <SelectItem value="anomaly">anomaly 异常输入</SelectItem>
              </SelectContent>
            </Select>
          </CardField>
        </div>

        {/* row 4: pass / fail */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <CardField label="✓ Pass 形态">
            <Textarea
              value={draft.passForm ?? ""}
              onChange={(e) => onChange({ passForm: e.target.value })}
              placeholder="什么样算 pass"
              className="min-h-[48px] text-[11.5px]"
            />
          </CardField>
          <CardField label="✗ Fail 形态">
            <Textarea
              value={draft.failForm ?? ""}
              onChange={(e) => onChange({ failForm: e.target.value })}
              placeholder="什么样算 fail"
              className="min-h-[48px] text-[11.5px]"
            />
          </CardField>
        </div>

        {/* floor 要素回标:自动预勾,可改;红线标红 */}
        {(() => {
          const cands = draft.targetEmployeeId
            ? floorElements.filter((f) => f.employeeId === draft.targetEmployeeId)
            : [];
          if (cands.length === 0) return null;
          const picked = new Set(draft.floorElementIds ?? []);
          const toggle = (id: string) => {
            const next = new Set(picked);
            next.has(id) ? next.delete(id) : next.add(id);
            onChange({ floorElementIds: [...next] });
          };
          return (
            <CardField label="关联下限 / 红线要素（自动回标，可改）">
              <div className="flex flex-wrap gap-1.5">
                {cands.map((f) => {
                  const on = picked.has(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggle(f.id)}
                      title={f.passForm}
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors",
                        on
                          ? "border-foreground/60 bg-foreground/10 font-medium text-foreground"
                          : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                      )}
                    >
                      {f.title}
                      {f.isRedLine && (
                        <span className="text-[9.5px] text-destructive">红线</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </CardField>
          );
        })()}

        {/* reference answer */}
        <CardField label="参考答案（可选）">
          <Textarea
            value={draft.referenceAnswer ?? ""}
            onChange={(e) => onChange({ referenceAnswer: e.target.value })}
            placeholder="对内 ground truth — judge agent 可用作打分依据"
            className="min-h-[48px] text-[11.5px]"
          />
        </CardField>

        {/* 拆链产出的 designNote 浓缩(judgeFocus):给 LLM 裁判的判分叮嘱,可改 */}
        {draft.judgeFocus !== undefined && (
          <CardField label="判分叮嘱（designNote → 给裁判）">
            <Textarea
              value={draft.judgeFocus ?? ""}
              onChange={(e) => onChange({ judgeFocus: e.target.value })}
              placeholder="出题时的设计意图(考点/期望/失败诱因),落到 judgeFocus 供 LLM 裁判参考"
              className="min-h-[48px] text-[11.5px]"
            />
          </CardField>
        )}
      </div>
    </details>
  );
}

/** 配置区统一小标题:图标 + 标题 + 可选灰色提示 + 必选红星。 */
function SectionTitle({
  icon,
  title,
  hint,
  required,
  hintTone = "muted",
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  required?: boolean;
  /** hint 文案的色调:muted 常规灰;warning 未满足时变橙提示(就地强调,不另起一行)。 */
  hintTone?: "muted" | "warning";
}) {
  return (
    <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span>{title}</span>
      {required && <span className="text-destructive">*</span>}
      {hint && (
        <span
          className={cn(
            "ml-1 text-[11px] font-normal",
            hintTone === "warning" ? "text-warning" : "text-muted-foreground",
          )}
        >
          {hint}
        </span>
      )}
    </h3>
  );
}

/** 紧凑开关行:勾选框 + 标题(可带「推荐」角标)+ 一行说明。替代厚边框大卡。 */
function ToggleRow({
  checked,
  onChange,
  label,
  tag,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  tag?: string;
  desc: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors",
        checked
          ? "border-accent/50 bg-accent/[0.04]"
          : "border-border bg-card hover:border-accent/40",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
          {label}
          {tag && (
            <span className="rounded bg-accent/15 px-1 py-px text-[9.5px] font-normal text-accent">
              {tag}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[10.5px] leading-relaxed text-muted-foreground">
          {desc}
        </span>
      </span>
    </label>
  );
}

function CardField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * 难度题数步进器:− / 数值 / +,一键点按调节(0-20)。
 * 取代原裸 number 输入框 — 出题数量都是个位数小整数,点按比键入顺手。
 */
function CountStepper({
  label,
  tone,
  value,
  onChange,
}: {
  label: string;
  tone: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const MIN = 0;
  const MAX = 20;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card px-2 py-1.5">
      <span className={cn("text-[10.5px] font-medium", tone)}>{label}</span>
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(MIN, value - 1))}
          disabled={value <= MIN}
          aria-label={`${label}减一`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          −
        </button>
        <span className="min-w-[2ch] text-center font-mono text-[15px] tabular-nums text-foreground">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(MAX, value + 1))}
          disabled={value >= MAX}
          aria-label={`${label}加一`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}

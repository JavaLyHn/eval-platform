import { FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { GenerateReportDialog } from "./generate-report-dialog";
import { useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/status-indicator";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { TrendChart } from "./trend-chart";
import type { DonutSegment } from "./donut-chart";
import { useQAStore } from "@/hooks/use-qa-store";
import { cn, formatRelativeTime } from "@/lib/utils";
import { ALL_EMPLOYEES_ID } from "@/lib/standard-employees";
import { reportVisibleTo } from "@/lib/report-visibility";
import { scopeEvaluationsToConversation } from "@/lib/dashboard-scope";
import { resolveEmployeeForProfile } from "@/lib/employee-resolve";
import { FAILURE_CATEGORIES, FAILURE_CATEGORY_META, UNATTRIBUTED_COLOR } from "@/lib/failure-attribution";
import { evaluateReleaseGate } from "@/lib/release-gate";
import { ReleaseGateCard } from "./release-gate-card";
import { DEFAULT_AUDIT_SAMPLE_RATE } from "@/lib/audit-queue";
import { loadSlice, saveSlice, STORAGE_KEYS } from "@/lib/persistence";
import type { Category, Evaluation, Question, StandardEmployee } from "@/types";

/**
 * 数据看板 — 顶层 employee 筛选 + 范围内的 KPI / 分布 / 趋势 / 类别 / Agent
 * 版本对比 / 失败题 / 员工对比。
 *
 * 「全体员工」(targetEmployeeId === "_all_") 的题目同时计入每位员工的视图，
 * 因为它们对所有 agent 都通用。
 */

/** "all" = 不过滤；其它 = StandardEmployee.id。*/
type EmpFilter = string | "all";

function questionMatches(q: Question, filter: EmpFilter): boolean {
  if (filter === "all") return true;
  // Specific employee: their own questions + 全体员工 (applies to everyone).
  return (
    q.targetEmployeeId === filter ||
    q.targetEmployeeId === ALL_EMPLOYEES_ID
  );
}

/** 员工关联的 agent profile id(employeeProfileMap 优先,回退 associatedProfileId)。 */
function linkedProfileFor(
  empId: string,
  employeeProfileMap: Record<string, string | null>,
  employees: StandardEmployee[],
): string | null {
  return (
    employeeProfileMap[empId] ??
    employees.find((e) => e.id === empId)?.associatedProfileId ??
    null
  );
}

/**
 * 某员工"拥有"的题:目标员工匹配,**或**被其关联 agent 评测过(即便题没显式绑定该员工)。
 * 这样"用 Aria 的 agent 答过/评过的题"也会进 Aria 的看板视图,而不只看题目的目标员工。
 */
function questionsForEmployee(
  empId: string,
  questions: Question[],
  evaluations: Evaluation[],
  linkedProfileId: string | null,
): Question[] {
  const agentQids = linkedProfileId
    ? new Set(
        evaluations
          .filter((e) => e.agentProfileId === linkedProfileId)
          .map((e) => e.questionId),
      )
    : null;
  return questions.filter(
    (q) => questionMatches(q, empId) || (agentQids?.has(q.id) ?? false),
  );
}

export function DashboardTab() {
  const {
    questions,
    evaluations,
    profiles,
    standardEmployees,
    reports,
    user,
    employeeProfileMap,
    conversations,
    activeConversation,
    activeConversationId,
    statsByQInActiveConv,
    switchConversation,
    configuredEmployeeIds,
    hydrated,
  } = useQAStore();
  // 看板只看单个员工(不提供「全部」汇总视图),默认第一位标准员工。
  // 注:configuredEmployees 由后续 useMemo 派生,声明顺序晚于此 useState,
  // 故初始值沿用 standardEmployees[0],再由 useEffect 校正到已配置员工。
  const [empFilter, setEmpFilter] = useState<EmpFilter>(
    () => standardEmployees[0]?.id ?? "all",
  );

  // 已配置员工列表(仅含用户已关联 agent 的员工)。
  const configuredEmployees = useMemo(
    () => standardEmployees.filter((e) => configuredEmployeeIds.includes(e.id)),
    [standardEmployees, configuredEmployeeIds],
  );

  // 若当前 empFilter 指向的员工不在已配置集(且不是聚合"all"),重置到首个已配置员工。
  useEffect(() => {
    if (empFilter === "all") return;
    if (configuredEmployees.some((e) => e.id === empFilter)) return;
    setEmpFilter(configuredEmployees[0]?.id ?? "all");
  }, [empFilter, configuredEmployees]);
  const [auditRate, setAuditRate] = useState<number>(() => {
    const v = loadSlice<number>(STORAGE_KEYS.auditSampleRate, DEFAULT_AUDIT_SAMPLE_RATE);
    return typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_AUDIT_SAMPLE_RATE;
  });
  const handleAuditRateChange = (val: number) => {
    setAuditRate(val);
    saveSlice(STORAGE_KEYS.auditSampleRate, val);
  };

  // 每个用户只看自己生成的报告(无主报告对所有人可见)。
  const visibleReports = useMemo(
    () => reports.filter((r) => reportVisibleTo(r, user)),
    [reports, user],
  );
  // 报告也按顶层 employee 筛选:「全部」看全量,选中单个员工只看该员工的报告。
  // 报告归属由其 agentProfileId 反查员工(显式关联 → associatedProfileId → 名称兜底);
  // 反查不到员工的报告只在「全部」视图出现。
  const scopedReports = useMemo(() => {
    if (empFilter === "all") return visibleReports;
    return visibleReports.filter(
      (r) =>
        resolveEmployeeForProfile(
          r.agentProfileId,
          profiles,
          standardEmployees,
          employeeProfileMap,
        )?.id === empFilter,
    );
  }, [visibleReports, empFilter, profiles, standardEmployees, employeeProfileMap]);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  // 失败题专辑 / 评测报告默认折叠(只显示前几条),避免看板被拉很长;可展开看全部。
  const [showAllFailed, setShowAllFailed] = useState(false);
  const [showAllReports, setShowAllReports] = useState(false);

  /* ---------- Scope by selected employee ---------- */

  // 「打过分」的回答消息 id 集合:有任一带数值分(autoScore != null)的评测命中。
  // trial-only(autoScore undefined)不算「打过分」。
  // 「已评测」的消息:有分数(autoScore)或有 verdict 都算。多 trial 专测通过率/pass^k,
  // 评测只记 verdict、不计分(autoScore 为空),若只认分数会把整条多 trial 运行会话从
  // ROUND 里隐掉。放宽到"有评测即算",让多 trial 轮也能进看板(分数栏对它本就为空)。
  const scoredMsgIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of evaluations)
      if (e.autoScore != null || e.verdict) s.add(e.messageId);
    return s;
  }, [evaluations]);

  // 轮次列表:① 选了某员工 → 只列「属于该员工的会话」(会话里有任一答题 agent 反查 = 此员工);
  // ② 一律只保留「已评测」的会话(有任一消息被评过 —— 含只记 verdict 的多 trial),
  //    完全没评过的轮次不显示。
  const scopedConversations = useMemo(() => {
    const byEmp =
      empFilter === "all"
        ? conversations
        : conversations.filter((c) =>
            c.messages.some(
              (m) =>
                m.agentProfileId != null &&
                resolveEmployeeForProfile(
                  m.agentProfileId,
                  profiles,
                  standardEmployees,
                  employeeProfileMap,
                )?.id === empFilter,
            ),
          );
    return byEmp.filter((c) => c.messages.some((m) => scoredMsgIds.has(m.id)));
  }, [
    conversations,
    empFilter,
    profiles,
    standardEmployees,
    employeeProfileMap,
    scoredMsgIds,
  ]);

  // 看板只看「单次会话」(不再提供跨轮汇总):当前会话必须属于选中员工才有数据。
  const activeBelongsToScope = scopedConversations.some(
    (c) => c.id === activeConversationId,
  );
  // 切换员工 chip 后,若当前会话不属于该员工 → 自动切到其最近一次会话,
  // 保证 statsByQInActiveConv(绑定全局活跃会话)与看板视图一致。
  useEffect(() => {
    if (activeBelongsToScope) return;
    const latest = scopedConversations[0];
    if (latest) switchConversation(latest.id);
    // 仅在员工切换 / 会话集变化时校正,switchConversation 引用稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empFilter, scopedConversations, activeBelongsToScope]);

  const showAllRounds = false; // 跨轮汇总已下线,保留变量名让下游统计逻辑不动

  const scopedQuestions = useMemo(() => {
    // 当前会话不属于选中员工(如该员工还没有任何会话)→ 无数据,
    // 避免把别的员工会话的 statsByQInActiveConv 串进来。
    if (!activeBelongsToScope) return [];
    // 先按员工收窄(原逻辑)
    const base =
      empFilter === "all"
        ? questions
        : questionsForEmployee(
            empFilter,
            questions,
            evaluations,
            linkedProfileFor(empFilter, employeeProfileMap, standardEmployees),
          );
    // 全部会话:维持全局 q.status/lastScore
    if (showAllRounds) return base;
    // 当前会话:只留「本会话答过的题」,并用 statsByQInActiveConv 覆盖 status/lastScore,
    // 下游所有读 q.status/q.lastScore 的统计无需改动。
    return base
      .filter((q) => statsByQInActiveConv.has(q.id))
      .map((q) => {
        const s = statsByQInActiveConv.get(q.id)!;
        return { ...q, status: s.status, lastScore: s.score };
      });
  }, [
    questions,
    empFilter,
    evaluations,
    employeeProfileMap,
    standardEmployees,
    showAllRounds,
    statsByQInActiveConv,
    activeBelongsToScope,
  ]);
  const scopedEvaluations = useMemo(() => {
    const ids = new Set(scopedQuestions.map((q) => q.id));
    if (showAllRounds) {
      return evaluations.filter((e) => ids.has(e.questionId));
    }
    // 当前会话:先按会话消息收窄,再交题目集 —— byVersion / 发版裁定 / perEmployee 自动跟随。
    const convMsgIds = new Set(
      (activeConversation?.messages ?? []).map((m) => m.id),
    );
    return scopeEvaluationsToConversation(evaluations, convMsgIds).filter((e) =>
      ids.has(e.questionId),
    );
  }, [evaluations, scopedQuestions, showAllRounds, activeConversation]);
  // 头部「评测」计数按**题**去重:困难题的多轮、同题的多 trial 都归到该题算一次,
  // 让「N 题 · M 评测」里的 M = 已被评过的题数,而不是逐轮逐 trial 的原始判分条数。
  // 注意:仅影响这个概览计数,逐轮 / 多 trial 判分记录本身不变(通过率 / pass^k 照旧)。
  const evaluatedQuestionCount = useMemo(
    () => new Set(scopedEvaluations.map((e) => e.questionId)).size,
    [scopedEvaluations],
  );
  // 趋势按**题**统计(与 KPI / 状态环一致):每道已判定的题按其题级 status 计一次,
  // 落到该题最近一次评测所在的日期。困难题多轮 / 同题多 trial 归到该题一次。
  const trendItems = useMemo(() => {
    const latestDateByQ = new Map<string, string>();
    for (const e of scopedEvaluations) {
      const prev = latestDateByQ.get(e.questionId);
      if (!prev || e.submittedAt > prev) latestDateByQ.set(e.questionId, e.submittedAt);
    }
    const out: { date: string; status: "passed" | "failed" }[] = [];
    for (const q of scopedQuestions) {
      if (q.status !== "passed" && q.status !== "failed") continue;
      const date = latestDateByQ.get(q.id);
      if (!date) continue;
      out.push({ date, status: q.status });
    }
    return out;
  }, [scopedQuestions, scopedEvaluations]);

  // 发版裁定(实时):当前 scope 的评测里只要有「失败 + 安全归因」即不可发布。
  const releaseGate = useMemo(
    () =>
      evaluateReleaseGate(
        scopedEvaluations.map((ev) => ({
          verdict: ev.verdict,
          failureAttribution: ev.failureAttribution,
          key: ev.questionId,
          label: questions.find((q) => q.id === ev.questionId)?.title,
          // 「全部」视图标明 blocker 属于哪位员工(按答题 agent 反查,回退题目目标员工);
          // 单员工视图已聚焦,无需标注。
          owner:
            empFilter === "all"
              ? (resolveEmployeeForProfile(
                  ev.agentProfileId,
                  profiles,
                  standardEmployees,
                  employeeProfileMap,
                )?.name ??
                standardEmployees.find(
                  (e) =>
                    e.id ===
                    questions.find((q) => q.id === ev.questionId)?.targetEmployeeId,
                )?.name)
              : undefined,
        })),
      ),
    [scopedEvaluations, questions, empFilter, profiles, standardEmployees, employeeProfileMap],
  );

  /* ---------- Core stats (scoped) ---------- */

  const stats = useMemo(() => {
    const total = scopedQuestions.length;
    const tested = scopedQuestions.filter((q) => q.status !== "untested").length;
    const passed = scopedQuestions.filter((q) => q.status === "passed").length;
    const failed = scopedQuestions.filter((q) => q.status === "failed").length;
    const scored = scopedQuestions.filter((q) => q.lastScore != null);
    const avg =
      scored.length > 0
        ? scored.reduce((s, q) => s + (q.lastScore ?? 0), 0) / scored.length
        : 0;
    return {
      total,
      tested,
      passed,
      failed,
      passRate: tested > 0 ? (passed / tested) * 100 : 0,
      avgScore: avg,
      testProgress: total > 0 ? (tested / total) * 100 : 0,
    };
  }, [scopedQuestions]);

  const byCategory = useMemo(() => {
    const groups = new Map<
      Category,
      { total: number; passed: number; avg: number; scored: number }
    >();
    for (const q of scopedQuestions) {
      const cats = Array.isArray(q.categories) ? q.categories : [];
      for (const cat of cats) {
        const existing =
          groups.get(cat) ?? { total: 0, passed: 0, avg: 0, scored: 0 };
        existing.total += 1;
        if (q.status === "passed") existing.passed += 1;
        if (q.lastScore != null) {
          existing.avg += q.lastScore;
          existing.scored += 1;
        }
        groups.set(cat, existing);
      }
    }
    return Array.from(groups.entries())
      .map(([category, v]) => ({
        category,
        total: v.total,
        passed: v.passed,
        passRate: v.total > 0 ? (v.passed / v.total) * 100 : 0,
        avgScore: v.scored > 0 ? v.avg / v.scored : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [scopedQuestions]);

  const byVersion = useMemo(() => {
    const groups = new Map<
      string,
      { total: number; passed: number; failed: number; scoreSum: number; scored: number }
    >();
    for (const ev of scopedEvaluations) {
      const profile = ev.agentProfileId
        ? profiles.find((p) => p.id === ev.agentProfileId)
        : null;
      const key = profile?.name ?? ev.modelVersion ?? "未知 Agent";
      const existing =
        groups.get(key) ?? { total: 0, passed: 0, failed: 0, scoreSum: 0, scored: 0 };
      existing.total += 1;
      // 多 trial 试跑评测不计分(autoScore 空),只进通过率,不进均分。
      if (ev.autoScore != null) {
        existing.scoreSum += ev.autoScore;
        existing.scored += 1;
      }
      if (ev.verdict === "passed") existing.passed += 1;
      else if (ev.verdict === "failed") existing.failed += 1;
      groups.set(key, existing);
    }
    return Array.from(groups.entries())
      .map(([version, v]) => ({
        version,
        total: v.total,
        passed: v.passed,
        failed: v.failed,
        passRate: v.total > 0 ? (v.passed / v.total) * 100 : 0,
        avgScore: v.scored > 0 ? v.scoreSum / v.scored : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [scopedEvaluations, profiles]);

  const statusDonut = useMemo<DonutSegment[]>(() => {
    let passed = 0;
    let failed = 0;
    let tested = 0;
    let untested = 0;
    for (const q of scopedQuestions) {
      if (q.status === "passed") passed++;
      else if (q.status === "failed") failed++;
      else if (q.status === "tested") tested++;
      else untested++;
    }
    return [
      { key: "passed", label: "通过", value: passed, color: "hsl(var(--success))" },
      { key: "failed", label: "失败", value: failed, color: "hsl(var(--destructive))" },
      { key: "tested", label: "已答未评", value: tested, color: "hsl(var(--warning))" },
      { key: "untested", label: "未测", value: untested, color: "hsl(var(--muted-foreground) / 0.45)" },
    ];
  }, [scopedQuestions]);

  const failureAttributionDonut = useMemo<DonutSegment[]>(() => {
    const counts = new Map<string, number>();
    let unattributed = 0;
    for (const ev of scopedEvaluations) {
      if (ev.verdict !== "failed") continue;
      const p = ev.failureAttribution?.primary;
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
      else unattributed += 1;
    }
    const segs: DonutSegment[] = FAILURE_CATEGORIES.map((c) => ({
      key: c,
      label: FAILURE_CATEGORY_META[c].label,
      value: counts.get(c) ?? 0,
      color: FAILURE_CATEGORY_META[c].color,
    }));
    if (unattributed > 0) {
      segs.push({ key: "unattributed", label: "未归因", value: unattributed, color: UNATTRIBUTED_COLOR });
    }
    return segs;
  }, [scopedEvaluations]);

  const failedTotal = useMemo(
    () => scopedEvaluations.filter((e) => e.verdict === "failed").length,
    [scopedEvaluations],
  );

  const difficultyDonut = useMemo<DonutSegment[]>(() => {
    let easy = 0;
    let medium = 0;
    let hard = 0;
    for (const q of scopedQuestions) {
      if (q.difficulty === "easy") easy++;
      else if (q.difficulty === "medium") medium++;
      else if (q.difficulty === "hard") hard++;
    }
    return [
      { key: "easy", label: "简单", value: easy, color: "hsl(var(--success))" },
      { key: "medium", label: "中等", value: medium, color: "hsl(var(--info))" },
      { key: "hard", label: "困难", value: hard, color: "hsl(var(--destructive))" },
    ];
  }, [scopedQuestions]);

  const failedQuestions = useMemo(() => {
    type Entry = {
      questionId: string;
      title: string;
      number: string;
      failCount: number;
      total: number;
      lastFailAt?: string;
      lastNote?: string;
    };
    const map = new Map<string, Entry>();
    for (const ev of scopedEvaluations) {
      const q = scopedQuestions.find((qq) => qq.id === ev.questionId);
      if (!q) continue;
      const entry: Entry =
        map.get(ev.questionId) ?? {
          questionId: ev.questionId,
          title: q.title,
          number: q.number,
          failCount: 0,
          total: 0,
        };
      entry.total += 1;
      if (ev.verdict === "failed") {
        entry.failCount += 1;
        if (
          !entry.lastFailAt ||
          new Date(ev.submittedAt) > new Date(entry.lastFailAt)
        ) {
          entry.lastFailAt = ev.submittedAt;
          entry.lastNote = ev.notes;
        }
      }
      map.set(ev.questionId, entry);
    }
    for (const q of scopedQuestions) {
      if (q.status === "failed" && !map.has(q.id)) {
        map.set(q.id, {
          questionId: q.id,
          title: q.title,
          number: q.number,
          failCount: 1,
          total: 1,
        });
      }
    }
    return Array.from(map.values())
      .filter((e) => e.failCount > 0)
      .sort(
        (a, b) =>
          b.failCount - a.failCount ||
          (b.lastFailAt ?? "").localeCompare(a.lastFailAt ?? ""),
      );
  }, [scopedQuestions, scopedEvaluations]);

  /* ---------- Per-employee comparison (uses raw, un-scoped data) ---------- */

  // 员工 → 其「现存会话」的消息 id 集(评测↔会话靠 messageId 关联)。
  // chips 计数据此只数现存会话里的评测 —— 删除会话后立即归零,不再吃历史孤儿评测。
  const liveMsgIdsByEmp = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const c of conversations) {
      const empIds = new Set<string>();
      for (const m of c.messages) {
        if (m.agentProfileId != null) {
          const emp = resolveEmployeeForProfile(
            m.agentProfileId,
            profiles,
            standardEmployees,
            employeeProfileMap,
          );
          if (emp) empIds.add(emp.id);
        }
      }
      for (const eid of empIds) {
        let set = map.get(eid);
        if (!set) {
          set = new Set();
          map.set(eid, set);
        }
        for (const m of c.messages) set.add(m.id);
      }
    }
    return map;
  }, [conversations, profiles, standardEmployees, employeeProfileMap]);

  const perEmployee = useMemo(() => {
    return configuredEmployees.map((emp) => {
      const linkedProfileId = linkedProfileFor(
        emp.id,
        employeeProfileMap,
        standardEmployees,
      );
      const empQs = questionsForEmployee(emp.id, questions, evaluations, linkedProfileId);
      // 成绩只看「该员工关联 agent 实测」的评测,按题取最新一次 verdict。
      // 不能用题目全局 q.status:全体员工题被某个 agent 测失败,会把 failed 串到
      // 所有员工(连没接入、没测过的也显示「失败需要重测」)。未接入 → 无评测 → 全 0。
      const empEvals = linkedProfileId
        ? evaluations.filter((e) => e.agentProfileId === linkedProfileId)
        : [];
      const latestByQ = new Map<string, Evaluation>();
      for (const ev of empEvals) {
        const prev = latestByQ.get(ev.questionId);
        if (!prev || new Date(ev.submittedAt) > new Date(prev.submittedAt)) {
          latestByQ.set(ev.questionId, ev);
        }
      }
      const latest = [...latestByQ.values()];
      const tested = latest.length;
      const passed = latest.filter((e) => e.verdict === "passed").length;
      const failed = latest.filter((e) => e.verdict === "failed").length;
      const scored = latest.filter((e) => e.autoScore != null);
      const avg =
        scored.length > 0
          ? scored.reduce((s, e) => s + (e.autoScore ?? 0), 0) / scored.length
          : 0;
      // chips 徽标:只数现存会话里的评测(删会话同步归零)。
      const liveMsgIds = liveMsgIdsByEmp.get(emp.id);
      const liveEvalCount = liveMsgIds
        ? evaluations.filter((e) => liveMsgIds.has(e.messageId)).length
        : 0;
      return {
        emp,
        total: empQs.length,
        tested,
        passed,
        failed,
        evalCount: empEvals.length,
        liveEvalCount,
        passRate: tested > 0 ? (passed / tested) * 100 : 0,
        avgScore: avg,
      };
    });
  }, [configuredEmployees, standardEmployees, questions, evaluations, employeeProfileMap, liveMsgIdsByEmp]);

  /* ---------- Render ---------- */

  const filterLabel =
    empFilter === "all"
      ? "全部"
      : (standardEmployees.find((e) => e.id === empFilter)?.name ?? empFilter);

  // boot 水合完成前只用 localStorage(可能是服务器数据的子集)。此时直接算 scope 统计,
  // 会先显示「少算」的数字、水合合入服务器评测/消息后再跳到正确值(用户观感=先错后对)。
  // 故未水合前不出数字,显示轻量占位;hydrated 每会话仅 boot 置一次 true(切 tab 不会再闪)。
  if (!hydrated) {
    return (
      <ScrollArea className="-mx-1 h-full dkm">
        <style>{DASHBOARD_CSS}</style>
        <DashboardSkeleton />
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="-mx-1 h-full dkm">
      <style>{DASHBOARD_CSS}</style>
      <div className="mx-auto max-w-[1240px] space-y-3.5 px-3.5 py-3.5">
        {/* 员工 chips(左,可横向滚动)+ 生成报告(右)同一行 */}
        <div className="dkm-rise flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <EmployeeFilterBar
              employees={configuredEmployees}
              value={empFilter}
              onChange={setEmpFilter}
              perEmployee={perEmployee}
            />
          </div>
          <button
            type="button"
            className="dkm-btn shrink-0"
            onClick={() => setReportDialogOpen(true)}
            title="把当前 scope + 选定 Agent 的题目 / 回答 / 评分冻结成一份只读报告"
          >
            <FileText className="h-3.5 w-3.5" /> 生成报告
          </button>
        </div>

        {/* 轮次选择 + scope 概要(同一行,mono 读数) */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--ink3)" }}>
            <span className="mono shrink-0 text-[10px] tracking-[.16em]" style={{ color: "var(--ink4)" }}>ROUND</span>
            {scopedConversations.length === 0 ? (
              <span className="italic" style={{ color: "var(--ink4)" }}>暂无已评测的轮次</span>
            ) : (
              <Select
                value={activeBelongsToScope ? (activeConversationId ?? "") : ""}
                onValueChange={(v) => {
                  if (v) switchConversation(v);
                }}
              >
                <SelectTrigger className="h-7 w-[240px] text-[12px]">
                  <SelectValue placeholder="选择会话…" />
                </SelectTrigger>
                <SelectContent className="max-w-[320px]">
                  {scopedConversations.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="mono text-[11px]" style={{ color: "var(--ink3)" }}>
            {scopedQuestions.length} 题 · {evaluatedQuestionCount} 评测
          </div>
        </div>

        {/* 发版裁定 + 校准:「全部」、或该员工**有已评测的轮次**、或已绑定 agent 时显示。
            关键:Dex 这类扩展员工靠 provider(gateway)认、无 associatedProfileId,
            linkedProfileFor 拿不到 → 不能只用它当闸门(否则有 671 评测 + 有 ROUND 却隐藏、
            做不了抽审)。只要有已评测轮次(scopedConversations>0)就显示;真·未接入无数据者仍隐藏。 */}
        {(empFilter === "all" ||
          scopedConversations.length > 0 ||
          !!linkedProfileFor(empFilter, employeeProfileMap, standardEmployees)) && (
          <>
        {/* 发版门(合并卡):红线硬判 / 校准 / 抽审三检 + 头部结论 chip;
            小样本时结论降级为「样本不足,仅供参考」,不给虚假信心。 */}
        <ReleaseGateCard
          evaluations={scopedEvaluations}
          questions={scopedQuestions}
          releaseGate={releaseGate}
          rate={auditRate}
          onRateChange={handleAuditRateChange}
        />
          </>
        )}

        {/* KPI 带:4 指标同卡、发丝线分隔;首格(当前主指标)底部加 accent 渐隐基线 */}
        <div className="dkm-card dkm-rise dkm-kpi">
          <div className="cell primary">
            <div className="cap">通过率 · PASS RATE</div>
            <div className="num">
              {stats.passRate.toFixed(0)}
              <span className="unit">%</span>
            </div>
            <div className="sub">
              {stats.passed} / {stats.tested} 已测
            </div>
          </div>
          <div className="cell">
            <div className="cap">平均分 · AVG</div>
            <div className="num">
              {stats.avgScore.toFixed(2)}
              <span className="unit">/10</span>
            </div>
            <div className="sub">
              来自 {scopedQuestions.filter((q) => q.lastScore != null).length} 道
            </div>
          </div>
          <div className="cell">
            <div className="cap">测试进度 · TESTED</div>
            <div className="num">
              {stats.testProgress.toFixed(0)}
              <span className="unit">%</span>
            </div>
            <div className="sub">
              {stats.tested} / {stats.total} 道
            </div>
          </div>
          <div className="cell">
            <div className="cap">失败 · FAILED</div>
            <div className="num" style={{ color: stats.failed > 0 ? "var(--fail)" : "var(--ink1)" }}>
              {stats.failed}
            </div>
            <div className="sub">需要重测</div>
          </div>
        </div>

        {/* 分布:84px 细环。语义降饱和、只作环上值色 */}
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          <div className="dkm-card dkm-rise">
            <BlockHead title="测试状态" slug="distribution" summary={`${stats.tested}/${stats.total} 已测`} />
            <ThinRing
              segments={statusDonut.map((s) => ({
                ...s,
                color:
                  (RING_STATUS_COLOR[s.key] ?? s.color),
              }))}
              centerValue={`${stats.testProgress.toFixed(0)}%`}
              centerLabel="已测"
            />
          </div>
          <div className="dkm-card dkm-rise">
            <BlockHead title="题目难度" slug="difficulty" summary={`${scopedQuestions.length} 题`} />
            <ThinRing
              segments={difficultyDonut.map((s) => ({
                ...s,
                color: (RING_DIFFICULTY_COLOR[s.key] ?? s.color),
              }))}
              centerValue={String(scopedQuestions.length)}
              centerLabel="题"
            />
          </div>
        </div>

        {/* Trend chart */}
        <TrendChart items={trendItems} />

        {/* 各类别表现:发丝线分隔 + 6px 细轨 + mono 右读数 */}
        <section className="dkm-card dkm-rise">
          <BlockHead
            title="各类别表现"
            slug="categories"
            summary={byCategory.length > 0 ? `${byCategory.length} 类` : undefined}
          />
          {byCategory.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px]" style={{ color: "var(--ink3)" }}>
              当前筛选下暂无类别数据
            </div>
          ) : (
            <div>
              {byCategory.map((row) => (
                <div key={row.category} className="dkm-row">
                  <div className="label">
                    <div className="name">{row.category}</div>
                    <div className="dkm-track">
                      <div className="fill" style={{ width: `${row.passRate}%` }} />
                    </div>
                  </div>
                  <div className="dkm-num">
                    <div className="big">
                      {row.passed}/{row.total}
                    </div>
                    <div className="cap">通过/总数</div>
                  </div>
                  <div className="dkm-num" style={{ width: "3.4rem" }}>
                    <div className="big">{row.avgScore > 0 ? row.avgScore.toFixed(2) : "—"}</div>
                    <div className="cap">均分</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 按 Agent 版本对比 */}
        <section className="dkm-card dkm-rise">
          <BlockHead
            title="按 Agent 版本对比"
            slug="versions"
            summary={byVersion.length > 0 ? `${byVersion.length} 个` : undefined}
          />
          {byVersion.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px]" style={{ color: "var(--ink3)" }}>
              暂无版本数据
            </div>
          ) : (
            <div>
              {byVersion.map((row) => (
                <div key={row.version} className="dkm-row">
                  <div className="label">
                    <div className="name mono">{row.version}</div>
                    <div className="text-[10.5px]" style={{ color: "var(--ink3)", marginTop: 4 }}>
                      {row.total} 次评测
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="dkm-chip pass">{row.passed} 通过</span>
                    {row.failed > 0 && <span className="dkm-chip fail">{row.failed} 失败</span>}
                  </div>
                  <div className="dkm-num" style={{ width: "3.4rem" }}>
                    <div className="big">{row.avgScore.toFixed(2)}</div>
                    <div className="cap">均分</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 失败归因:整宽 8px 分段 tape(无归因 → 整条 idle 灰) */}
        <section className="dkm-card dkm-rise">
          <BlockHead title="失败归因" slug="attribution" summary={`${failedTotal} 失败`} />
          {failedTotal === 0 ? (
            <div className="px-4 py-8 text-center text-[12px]" style={{ color: "var(--ink3)" }}>
              当前筛选下暂无失败题
            </div>
          ) : (
            <SegmentedTape segments={failureAttributionDonut} />
          )}
        </section>

        {/* 失败题专辑:凹陷引用块(accent 左边线)+ mono "n/总" 失败读数 */}
        <section className="dkm-card dkm-rise">
          <BlockHead
            title="失败题专辑"
            slug="failures"
            summary={failedQuestions.length > 0 ? `${failedQuestions.length} 题` : undefined}
          />
          {failedQuestions.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px]" style={{ color: "var(--ink3)" }}>
              暂无失败题目 🎉
            </div>
          ) : (
            <div>
              {(showAllFailed ? failedQuestions : failedQuestions.slice(0, 5)).map((row) => {
                const q = scopedQuestions.find((qq) => qq.id === row.questionId);
                return (
                  <div
                    key={row.questionId}
                    className="dkm-row"
                    style={{ gridTemplateColumns: "1fr auto", alignItems: "start" }}
                  >
                    <div className="min-w-0">
                      <div className="line-clamp-2 break-words text-[13px]" style={{ color: "var(--ink1)" }}>
                        {row.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px]" style={{ color: "var(--ink3)" }}>
                        {q && <StatusBadge value={q.status} />}
                        {row.lastFailAt && <span>最近失败 {formatRelativeTime(row.lastFailAt)}</span>}
                      </div>
                      {row.lastNote && (
                        <div className="dkm-quote mt-2 line-clamp-2">{row.lastNote}</div>
                      )}
                    </div>
                    <div className="dkm-num">
                      <div className="big" style={{ color: "var(--fail)" }}>
                        {row.failCount}/{row.total}
                      </div>
                      <div className="cap">失败</div>
                    </div>
                  </div>
                );
              })}
              {failedQuestions.length > 5 && (
                <button
                  type="button"
                  className="dkm-more"
                  onClick={() => setShowAllFailed((v) => !v)}
                >
                  {showAllFailed ? "收起" : `展开全部 ${failedQuestions.length} 题`}
                </button>
              )}
            </div>
          )}
        </section>

        {/* 员工对比（全量）— 仅在「全部」视图显示;选中单个员工时隐藏 */}
        {empFilter === "all" && (
          <section className="dkm-card dkm-rise">
            <BlockHead title="员工对比（全量）" slug="employees" summary="点卡片切到该员工" />
            {configuredEmployees.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-[12px] text-muted-foreground">
                还没有为任何员工配置 agent —— 去「员工」里关联后这里才有数据。
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 px-4 pb-4 pt-1 sm:grid-cols-2 lg:grid-cols-3">
                {perEmployee.map((row) => (
                  <EmployeeCompareCard
                    key={row.emp.id}
                    row={row}
                    isActive={empFilter === row.emp.id}
                    onClick={() =>
                      setEmpFilter(empFilter === row.emp.id ? "all" : row.emp.id)
                    }
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* 已生成报告:发丝线数据表(mono 大写表头、右对齐 tabular、通过/失败圆点) */}
        <section className="dkm-card dkm-rise">
          <BlockHead
            title="评测报告"
            slug="reports"
            summary={
              scopedReports.length > 0 ? (
                <Link to="/reports" className="dkm-link">
                  查看全部 →
                </Link>
              ) : undefined
            }
          />
          {scopedReports.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px]" style={{ color: "var(--ink3)" }}>
              {empFilter === "all"
                ? "还没生成过报告。点上方「生成报告」把当前评测冻结成一份快照。"
                : `${filterLabel} 还没有评测报告。点上方「生成报告」为该员工生成一份。`}
            </div>
          ) : (
            <div>
              <div className="dkm-table-h" style={{ gridTemplateColumns: "1fr 3rem 3rem 3rem" }}>
                <span>报告 · REPORT</span>
                <span className="text-right">题</span>
                <span className="text-right">通过</span>
                <span className="text-right">失败</span>
              </div>
              {scopedReports.slice(0, showAllReports ? 30 : 5).map((r) => {
                const passed = r.items.filter((i) => i.verdict === "passed").length;
                const failed = r.items.filter((i) => i.verdict === "failed").length;
                return (
                  <Link
                    key={r.id}
                    to={`/reports/${encodeURIComponent(r.id)}`}
                    className="dkm-trow"
                    style={{ gridTemplateColumns: "1fr 3rem 3rem 3rem" }}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px]" style={{ color: "var(--ink1)" }}>
                        {r.title}
                      </div>
                      <div className="mt-0.5 truncate text-[10.5px]" style={{ color: "var(--ink3)" }}>
                        {r.agentName} · {formatRelativeTime(r.createdAt)}
                      </div>
                    </div>
                    <div className="mono text-right text-[12px]" style={{ color: "var(--ink2)" }}>
                      {r.items.length}
                    </div>
                    <div className="mono inline-flex items-center justify-end gap-1 text-right text-[12px]" style={{ color: "var(--ink1)" }}>
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--pass)" }} />
                      {passed}
                    </div>
                    <div className="mono inline-flex items-center justify-end gap-1 text-right text-[12px]" style={{ color: failed > 0 ? "var(--ink1)" : "var(--ink4)" }}>
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: failed > 0 ? "var(--fail)" : "var(--idle)" }} />
                      {failed}
                    </div>
                  </Link>
                );
              })}
              {scopedReports.length > 5 && (
                <button
                  type="button"
                  className="dkm-more"
                  onClick={() => setShowAllReports((v) => !v)}
                >
                  {showAllReports ? "收起" : `展开全部 ${Math.min(scopedReports.length, 30)} 份`}
                </button>
              )}
              {showAllReports && scopedReports.length > 30 && (
                <div className="px-4 py-2 text-center text-[10.5px]" style={{ color: "var(--ink4)" }}>
                  还有 {scopedReports.length - 30} 份历史报告未显示
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <GenerateReportDialog
        open={reportDialogOpen}
        onOpenChange={setReportDialogOpen}
        scopedQuestionIds={scopedQuestions.map((q) => q.id)}
        scopeLabel={filterLabel}
      />
    </ScrollArea>
  );
}

/* ===================== Instrument-panel theme (scoped) =====================
   "给 agent 验金的仪表台":白底 + 冷灰发丝线 + 唯一冷调强调色 + 等宽读数。
   语义色只作细条 / 圆点 / 小芯片,绝不大面积色块。整套 token 收在 .dkm 下,
   不泄漏到全局、不随应用深色模式翻转(刻意固定浅色仪器面板)。 */
const DASHBOARD_CSS = `
.dkm{
  /* 强制浅色「仪表岛」:把 app 语义 token 在本子树重置为浅色 HSL,使内嵌的
     app 组件(趋势图 / Select / StatusBadge / 发版门卡)即使在应用深色模式下
     也保持浅色,不与冷调浅底冲突。仅作用于 .dkm 子树。 */
  --background:0 0% 100%;--foreground:222 47% 11%;
  --surface:210 40% 98%;--surface-foreground:222 47% 11%;
  --card:0 0% 100%;--card-foreground:222 47% 11%;
  --popover:0 0% 100%;--popover-foreground:222 47% 11%;
  --primary:222 47% 11%;--primary-foreground:210 40% 98%;
  --secondary:210 40% 96%;--secondary-foreground:222 47% 11%;
  --muted:210 40% 96%;--muted-foreground:215 16% 47%;
  --accent:217 91% 60%;--accent-foreground:0 0% 100%;
  --destructive:0 72% 51%;--destructive-foreground:0 0% 100%;
  --success:142 71% 38%;--success-foreground:0 0% 100%;
  --warning:38 92% 50%;--warning-foreground:0 0% 100%;
  --info:217 91% 60%;--info-foreground:0 0% 100%;
  --border:214 32% 91%;--input:214 32% 91%;--ring:217 91% 60%;
  --bg:#F6F7F9;--dk-surface:#FFFFFF;--dk-surface-2:#F3F5F8;--inset:#ECEEF2;
  --l1:rgba(15,28,54,.09);--l2:rgba(15,28,54,.14);--l3:rgba(15,28,54,.20);
  --ink1:#1A1D24;--ink2:#5A6372;--ink3:#878F9C;--ink4:#AEB5C0;
  --dk-accent:#2563EB;--dk-accent-soft:rgba(37,99,235,.10);
  --pass:#1E9E6A;--fail:#D14343;--mid:#B5862B;--idle:#B4BAC4;
  --shadow:0 1px 2px rgba(16,24,40,.04),0 1px 3px rgba(16,24,40,.02);
  --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  background:var(--bg);color:var(--ink1);font-family:var(--sans);
  -webkit-font-smoothing:antialiased;
}
.dkm *{box-sizing:border-box;}
.dkm .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}

/* 卡片:轻浮于灰底,不靠粗边框 */
.dkm-card{background:var(--dk-surface);border:1px solid var(--l1);border-radius:13px;box-shadow:var(--shadow);}

/* 区块标题:eyebrow 中文标题 + mono 英文 slug + 右侧汇总值 */
.dkm-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:14px 16px 10px;}
.dkm-head .t{display:flex;align-items:baseline;gap:8px;min-width:0;}
.dkm-head .title{font-size:13.5px;font-weight:600;color:var(--ink1);letter-spacing:.2px;}
.dkm-head .slug{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink4);}
.dkm-head .sum{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:11.5px;color:var(--ink2);white-space:nowrap;}
.dkm-divider{height:1px;background:var(--l1);}

/* KPI 带:4 格同卡、发丝线分隔 */
.dkm-kpi{display:grid;grid-template-columns:repeat(4,1fr);}
.dkm-kpi .cell{position:relative;padding:16px 16px 18px;border-left:1px solid var(--l1);}
.dkm-kpi .cell:first-child{border-left:0;}
.dkm-kpi .cap{font-size:11px;color:var(--ink3);letter-spacing:.02em;}
.dkm-kpi .num{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:32px;line-height:1.05;font-weight:600;color:var(--ink1);margin-top:6px;display:flex;align-items:baseline;gap:4px;}
.dkm-kpi .num .unit{font-size:14px;font-weight:500;color:var(--ink3);}
.dkm-kpi .sub{font-size:11px;color:var(--ink3);margin-top:5px;}
.dkm-kpi .cell.primary::after{content:"";position:absolute;left:16px;right:16px;bottom:10px;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--dk-accent),rgba(37,99,235,0));}
.dkm-chip{display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--l1);}
.dkm-chip.pass{color:var(--pass);background:rgba(30,158,106,.08);border-color:rgba(30,158,106,.20);}
.dkm-chip.fail{color:var(--fail);background:rgba(209,67,67,.08);border-color:rgba(209,67,67,.20);}
.dkm-chip.mid{color:var(--mid);}
.dkm-chip.idle{color:var(--ink2);}

/* 细环 */
.dkm-ring-wrap{display:grid;grid-template-columns:84px 1fr;gap:14px;align-items:center;padding:4px 16px 16px;}
.dkm-ring-center{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:17px;font-weight:600;fill:var(--ink1);}
.dkm-ring-cap{font-size:9.5px;fill:var(--ink3);}
.dkm-legend{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;}
.dkm-legend .it{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--ink2);}
.dkm-legend .it.zero{color:var(--ink4);}
.dkm-legend .dot{width:7px;height:7px;border-radius:999px;flex:none;}
.dkm-legend .v{margin-left:auto;font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--ink1);}
.dkm-legend .it.zero .v{color:var(--ink4);}

/* 失败归因 tape */
.dkm-tape{display:flex;height:8px;width:100%;border-radius:999px;overflow:hidden;background:var(--inset);}
.dkm-tape .seg{height:100%;}

/* 进度行(类别 / 版本) */
.dkm-row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:14px;padding:11px 16px;border-top:1px solid var(--l1);}
.dkm-row:first-child{border-top:0;}
.dkm-row .label{min-width:0;}
.dkm-row .label .name{font-size:13px;color:var(--ink1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dkm-row .label .name.mono{font-size:12px;}
.dkm-track{height:6px;border-radius:999px;background:var(--inset);overflow:hidden;margin-top:7px;}
.dkm-track .fill{height:100%;border-radius:999px;background:linear-gradient(90deg,rgba(30,158,106,.85),var(--pass));transition:width .5s ease;}
.dkm-num{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;}
.dkm-num .big{font-size:14px;font-weight:600;color:var(--ink1);}
.dkm-num .sm{font-size:11px;color:var(--ink3);}
.dkm-num .cap{font-size:9.5px;color:var(--ink4);margin-top:2px;}

/* 发丝线数据表(报告) */
.dkm-table-h{display:grid;align-items:center;gap:10px;padding:8px 16px;font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink4);border-bottom:1px solid var(--l1);}
.dkm-trow{display:grid;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid var(--l1);transition:background .12s ease;}
.dkm-trow:first-of-type{border-top:0;}
.dkm-trow:hover{background:rgba(37,99,235,.035);}

/* 折叠/展开按钮(失败题专辑 / 评测报告 底部) */
.dkm-more{display:block;width:100%;padding:9px 16px;border-top:1px solid var(--l1);background:transparent;color:var(--ink2);font-family:var(--sans);font-size:11.5px;cursor:pointer;transition:background .12s,color .12s;}
.dkm-more:hover{background:rgba(37,99,235,.035);color:var(--dk-accent);}

/* 凹陷引用块(失败题 note) */
.dkm-quote{background:var(--dk-surface-2);border-left:2px solid var(--dk-accent);border-radius:0 7px 7px 0;padding:7px 10px;font-size:11.5px;color:var(--ink2);}

/* 员工 chips */
.dkm-chips{display:flex;gap:6px;overflow-x:auto;padding:2px 0;}
.dkm-chips::-webkit-scrollbar{height:0;}
.dkm-ec{display:inline-flex;align-items:center;gap:6px;flex:none;padding:5px 10px;border-radius:999px;border:1px solid var(--l1);background:var(--dk-surface);color:var(--ink2);font-size:11.5px;cursor:pointer;transition:border-color .14s,color .14s,background .14s;}
.dkm-ec:hover{border-color:var(--l2);color:var(--ink1);}
.dkm-ec.on{border-color:var(--dk-accent);color:var(--dk-accent);background:var(--dk-accent-soft);}
.dkm-ec .c{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:10px;color:var(--ink4);}
.dkm-ec.on .c{color:var(--dk-accent);}

/* 员工对比卡 */
.dkm-cmp{display:block;width:100%;text-align:left;border:1px solid var(--l1);background:var(--dk-surface);border-radius:11px;padding:11px;cursor:pointer;transition:border-color .14s,box-shadow .14s;}
.dkm-cmp:hover{border-color:var(--l2);box-shadow:var(--shadow);}
.dkm-cmp.on{border-color:var(--dk-accent);background:var(--dk-accent-soft);}

/* 控件 */
.dkm-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:9px;border:1px solid var(--dk-accent);background:#fff;color:var(--dk-accent);font-size:12px;font-weight:600;cursor:pointer;transition:background .14s;}
.dkm-btn:hover{background:var(--dk-accent-soft);}
.dkm a.dkm-link{color:var(--dk-accent);text-decoration:none;}
.dkm a.dkm-link:hover{text-decoration:underline;}
.dkm :focus-visible{outline:2px solid var(--dk-accent);outline-offset:2px;border-radius:8px;}

/* 趋势图(scoped 覆盖,见 trend-chart.tsx 的 var fallback) */
.dkm-trend-seg{display:inline-flex;align-items:center;gap:0.5rem;}

/* 载入轻微上浮(尊重 prefers-reduced-motion) */
.dkm-rise{animation:dkmRise .45s cubic-bezier(.2,.7,.3,1) both;}
@keyframes dkmRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (max-width:860px){.dkm-kpi{grid-template-columns:1fr 1fr;}.dkm-kpi .cell:nth-child(3){border-left:0;}}
@media (prefers-reduced-motion:reduce){.dkm-rise{animation:none;}}

/* 骨架:开机同步未完成时,用与真实看板同构的占位填满,不再一句话居中空屏 */
.dkm-skel{display:block;border-radius:6px;background:linear-gradient(90deg,var(--inset) 25%,var(--dk-surface-2) 37%,var(--inset) 63%);background-size:400% 100%;animation:dkmShimmer 1.4s ease-in-out infinite;}
.dkm-skel.pill{border-radius:999px;}
@keyframes dkmShimmer{0%{background-position:100% 0}100%{background-position:0 0}}
@media (prefers-reduced-motion:reduce){.dkm-skel{animation:none;}}
`;

/** 一根骨架条。 */
function Skel({
  w,
  h = 12,
  pill,
  className,
}: {
  w: number | string;
  h?: number;
  pill?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`dkm-skel${pill ? " pill" : ""}${className ? " " + className : ""}`}
      style={{ width: typeof w === "number" ? `${w}px` : w, height: h }}
    />
  );
}

/**
 * 数据看板开机骨架:开机同步(hydration)完成前显示,和真实看板同构
 * ——员工筛选条 + ROUND 行 + 发版门卡 + KPI 四格 + 两个区块——不再一句话居中空屏。
 * 只画占位形状、不出任何数字(避免用未合并的本地数据显示「先错后对」的假数)。
 */
function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1240px] space-y-3.5 px-3.5 py-3.5" aria-busy="true">
      {/* 员工 chips + 生成报告 */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {[72, 56, 64, 60, 52, 68].map((w, i) => (
            <Skel key={i} w={w} h={26} pill />
          ))}
        </div>
        <Skel w={92} h={30} />
      </div>

      {/* ROUND 行 + scope 概要 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="mono text-[10px] tracking-[.16em]" style={{ color: "var(--ink4)" }}>
            ROUND
          </span>
          <Skel w={240} h={28} />
        </div>
        <div className="flex items-center gap-2">
          <span className="mono text-[11px]" style={{ color: "var(--ink4)" }}>
            正在校准数据…
          </span>
          <Skel w={96} h={14} />
        </div>
      </div>

      {/* 发版门卡 */}
      <div className="dkm-card" style={{ padding: "14px 16px" }}>
        <div className="flex items-center justify-between">
          <Skel w={140} h={15} />
          <Skel w={88} h={22} pill />
        </div>
        <div className="mt-3 space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skel w={16} h={16} pill />
              <Skel w={i === 0 ? "42%" : i === 1 ? "56%" : "34%"} h={12} />
              <span className="ml-auto">
                <Skel w={72} h={12} />
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* KPI 四格 */}
      <div className="dkm-card dkm-kpi">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="cell">
            <Skel w={92} h={11} />
            <div style={{ marginTop: 10 }}>
              <Skel w={i === 0 ? 76 : 60} h={30} />
            </div>
            <div style={{ marginTop: 8 }}>
              <Skel w={70} h={11} />
            </div>
          </div>
        ))}
      </div>

      {/* 两个区块卡(标题 + 几行) */}
      {[0, 1].map((c) => (
        <section key={c} className="dkm-card">
          <div className="dkm-head">
            <div className="t">
              <Skel w={96} h={14} />
              <Skel w={54} h={10} />
            </div>
            <Skel w={64} h={11} />
          </div>
          <div className="dkm-divider" />
          <div style={{ padding: "6px 16px 14px" }} className="space-y-3">
            {[0, 1, 2].map((r) => (
              <div key={r} className="flex items-center gap-3">
                <Skel w={`${28 + r * 12}%`} h={12} />
                <span className="ml-auto">
                  <Skel w={40} h={12} />
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 细环里语义色一律改用降饱和的仪表 token(代替 app 的交通灯 success/destructive)。 */
const RING_STATUS_COLOR: Record<string, string> = {
  passed: "var(--pass)",
  failed: "var(--fail)",
  tested: "var(--mid)",
  untested: "var(--idle)",
};
const RING_DIFFICULTY_COLOR: Record<string, string> = {
  easy: "var(--pass)",
  medium: "var(--dk-accent)",
  hard: "var(--fail)",
};

/* ============================ Sub-components ============================ */

function EmployeeFilterBar({
  employees,
  value,
  onChange,
  perEmployee,
}: {
  employees: StandardEmployee[];
  value: EmpFilter;
  onChange: (v: EmpFilter) => void;
  perEmployee: Array<{ emp: StandardEmployee; liveEvalCount: number }>;
}) {
  return (
    <div className="dkm-chips">
      {/* 「全部」汇总视图已下线 —— 看板只看单个员工 */}
      {employees.map((e) => {
        const stats = perEmployee.find((p) => p.emp.id === e.id);
        // 徽标 = 该员工现存会话里的评测条数(删会话即归零,与数据严格同步)
        const count = stats?.liveEvalCount ?? 0;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onChange(e.id)}
            className={cn("dkm-ec", value === e.id && "on")}
          >
            <EmployeeAvatar employee={e} size={14} />
            <span>{e.name}</span>
            <span className="c">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 区块标题:eyebrow 中文标题 + mono 英文 slug + 右侧 mono 汇总值。 */
function BlockHead({
  title,
  slug,
  summary,
  icon,
}: {
  title: string;
  slug: string;
  summary?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <>
      <div className="dkm-head">
        <span className="t">
          {icon}
          <span className="title">{title}</span>
          <span className="slug">{slug}</span>
        </span>
        {summary != null && <span className="sum">{summary}</span>}
      </div>
      <div className="dkm-divider" />
    </>
  );
}

/** 84px 细环(6px 描边):底槽 inset + 值色;中心 mono 读数 + cap;2×2 图例,0 值灰掉。 */
function ThinRing({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
}) {
  const size = 84;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  let offset = 0;
  const arcs =
    total > 0
      ? segments.map((s) => {
          const len = (Math.max(0, s.value) / total) * C;
          const a = { ...s, len, off: offset };
          offset += len;
          return a;
        })
      : [];
  return (
    <div className="dkm-ring-wrap">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--inset)" strokeWidth={stroke} />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={stroke}
              strokeDasharray={`${a.len} ${C - a.len}`}
              strokeDashoffset={-a.off}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="mono" style={{ fontSize: 17, fontWeight: 600, color: "var(--ink1)" }}>
            {centerValue}
          </span>
          <span style={{ fontSize: 9.5, color: "var(--ink3)", marginTop: 1 }}>{centerLabel}</span>
        </div>
      </div>
      <ul className="dkm-legend">
        {segments.map((s) => (
          <li key={s.key} className={cn("it", s.value === 0 && "zero")}>
            <span className="dot" style={{ backgroundColor: s.value === 0 ? "var(--idle)" : s.color }} />
            <span className="truncate">{s.label}</span>
            <span className="v mono">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 全宽 8px 分段 tape + 图例网格;无归因时整条 idle 灰。 */
function SegmentedTape({ segments }: { segments: DonutSegment[] }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  return (
    <div className="px-4 pb-4 pt-1">
      <div className="dkm-tape">
        {total > 0 ? (
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span
                key={s.key}
                className="seg"
                style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
                title={`${s.label}: ${s.value}`}
              />
            ))
        ) : (
          <span className="seg" style={{ width: "100%", backgroundColor: "var(--idle)" }} />
        )}
      </div>
      <ul className="dkm-legend mt-3">
        {segments.map((s) => (
          <li key={s.key} className={cn("it", s.value === 0 && "zero")}>
            <span className="dot" style={{ backgroundColor: s.value === 0 ? "var(--idle)" : s.color }} />
            <span className="truncate">{s.label}</span>
            <span className="v mono">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmployeeCompareCard({
  row,
  isActive,
  onClick,
}: {
  row: {
    emp: StandardEmployee;
    total: number;
    tested: number;
    passed: number;
    failed: number;
    evalCount: number;
    passRate: number;
    avgScore: number;
  };
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("dkm-cmp", isActive && "on")}
    >
      <div className="flex items-center gap-2">
        <EmployeeAvatar employee={row.emp} size={20} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium" style={{ color: "var(--ink1)" }}>
            {row.emp.name}
          </div>
          <div className="truncate text-[10.5px]" style={{ color: "var(--ink3)" }}>
            {row.emp.title}
          </div>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <Stat label="题目" value={row.total} />
        <Stat label="评测" value={row.evalCount} />
        <Stat label="均分" value={row.avgScore > 0 ? row.avgScore.toFixed(2) : "—"} />
      </div>
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[10.5px]">
          <span style={{ color: "var(--ink3)" }}>通过率</span>
          <span className="mono" style={{ color: "var(--ink1)" }}>
            {row.tested > 0 ? `${row.passRate.toFixed(0)}%` : "—"}
          </span>
        </div>
        <div className="dkm-track">
          <div className="fill" style={{ width: `${row.passRate}%` }} />
        </div>
      </div>
      {row.failed > 0 && (
        <div className="mt-1.5 inline-flex">
          <span className="dkm-chip fail mono">{row.failed} 失败待重测</span>
        </div>
      )}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md py-1 text-center" style={{ background: "var(--dk-surface-2)" }}>
      <div className="mono text-[12.5px] font-semibold" style={{ color: "var(--ink1)" }}>
        {value}
      </div>
      <div className="text-[9.5px]" style={{ color: "var(--ink3)" }}>
        {label}
      </div>
    </div>
  );
}

/**
 * Serialize an EvaluationReport snapshot into a self-contained Markdown
 * document. Triggered by the user clicking "导出 Markdown" on the report
 * preview page — never automatic.
 */

import type { EvaluationReport, ReportItem, MetricRow } from "@/types";
import { diffReportMetrics, passKWasRun, summarizeDiff } from "./report-metrics";
import { mdToHtml } from "./md-to-html";
import { FAILURE_CATEGORY_META } from "./failure-attribution";

/** baseline:用户在报告页选中的对比版本(可空 = 不对比)。 */
export function reportToMarkdown(
  report: EvaluationReport,
  baseline?: EvaluationReport,
): string {
  const lines: string[] = [];
  lines.push(`# 评测报告 · ${report.title}`);
  lines.push("");
  lines.push(`- **被测 Agent**：${report.agentName}`);
  lines.push(`- **生成时间**：${formatDate(report.createdAt)}`);
  lines.push(`- **题目数**：${report.items.length}`);

  const passCount = report.items.filter((i) => i.verdict === "passed").length;
  const failCount = report.items.filter((i) => i.verdict === "failed").length;
  lines.push(`- **通过 / 失败**：${passCount} / ${failCount}`);
  const scored = report.items.filter((i) => typeof i.autoScore === "number");
  const avg =
    scored.length > 0
      ? scored.reduce((s, i) => s + (i.autoScore ?? 0), 0) / scored.length
      : 0;
  lines.push(
    `- **平均分**：${avg > 0 ? avg.toFixed(2) : "—"} / 10`,
  );

  appendMetrics(lines, report, baseline);

  lines.push("");
  lines.push("---");
  lines.push("");

  report.items.forEach((item, idx) => {
    appendItem(lines, idx + 1, item);
  });

  appendGlossary(lines, report.metrics ? passKWasRun(report.metrics) : false);

  return lines.join("\n");
}

function appendItem(lines: string[], n: number, item: ReportItem) {
  lines.push(`## ${n}. ${item.questionTitle}`);
  lines.push("");
  lines.push("**题目**");
  lines.push("");
  lines.push(quote(item.questionPrompt));
  lines.push("");
  // 题目附件(随题发送给 agent):列出文件名/类型/大小;文本类连正文一并附上(faithful)。
  if (item.attachments && item.attachments.length > 0) {
    lines.push(`**附件（随题发送给 agent · ${item.attachments.length}）**`);
    lines.push("");
    for (const a of item.attachments) {
      lines.push(`- \`${a.name}\` — ${a.type || "未知类型"} · ${a.size} B`);
      if (a.text && a.text.trim()) {
        lines.push("");
        lines.push("~~~"); // 用 ~~~ 围栏避开正文里可能出现的 ``` 冲突
        lines.push(a.text.trim());
        lines.push("~~~");
        lines.push("");
      }
    }
    lines.push("");
  }
  // 多 trial 试跑:逐次列出回答+判定 + pass^k 汇总(设计上只判通过/失败、不打分)。
  if (item.trials && item.trials.length > 0) {
    const pk = item.passK;
    const passed = pk?.passed ?? item.trials.filter((t) => t.verdict === "passed").length;
    const total = pk?.trials ?? item.trials.length;
    const kk = pk?.k ?? item.trials.length;
    lines.push(
      `**多 trial 试跑(${kk} 次 · 通过 ${passed}/${total} · ${pk?.passPowerK ? "pass^k 达标" : "pass^k 未达标(任一次失败即不达标)"})**`,
    );
    lines.push("");
    item.trials.forEach((t) => {
      const v = t.verdict === "passed" ? "✓ 通过" : "✗ 失败";
      lines.push(`### 第 ${t.trialIndex + 1} 次 — ${v}`);
      lines.push("");
      lines.push(t.answer.trim() || "_（无回答）_");
      if (t.notes) {
        lines.push("");
        lines.push(`> 评语：${t.notes.replace(/\n+/g, " ")}`);
      }
      lines.push("");
    });
  } else if (item.subResults && item.subResults.length > 0) {
    // 困难题逐轮:逐轮列出提问+回答+判定;否则单条回答。
    lines.push(`**逐轮回答(${item.subResults.length} 轮 · 任一轮失败即整题失败)**`);
    lines.push("");
    item.subResults.forEach((s) => {
      const v = s.verdict === "passed" ? "✓ 通过" : "✗ 失败";
      const score = typeof s.autoScore === "number" ? ` · ${s.autoScore.toFixed(2)}/10` : "";
      lines.push(`### 第 ${s.subIndex + 1} 轮 — ${v}${score}`);
      lines.push("");
      if (s.userPrompt) {
        lines.push(quote(s.userPrompt));
        lines.push("");
      }
      lines.push(s.answer.trim() || "_（无回答）_");
      if (s.scores.length > 0) {
        lines.push("");
        lines.push(
          `维度：${s.scores.map((d) => `${d.label} ${d.value.toFixed(1)}`).join(" · ")}`,
        );
      }
      if (s.notes) {
        lines.push("");
        lines.push(`> 评语：${s.notes.replace(/\n+/g, " ")}`);
      }
      lines.push("");
    });
  } else {
    lines.push("**Agent 回答**");
    lines.push("");
    lines.push(item.answer.trim() || "_（无回答）_");
    lines.push("");
  }
  lines.push("**评分**");
  lines.push("");
  lines.push(
    `- 判定：${item.verdict === "passed" ? "✓ 通过" : "✗ 失败"}`,
  );
  if (item.passK) {
    lines.push(
      `- pass^k：${item.passK.passPowerK ? "达标" : "未达标"}（${item.passK.k} 次跑满且每次都过才算过 · 实际通过 ${item.passK.passed}/${item.passK.trials}）`,
    );
  }
  // 顶层不再给聚合均分;得分细节在各裁判/各轮各自下面。
  // 综合维度仅兜底:无逐裁判维度、也无逐轮时才列(避免与各裁判维度重复)。
  const hasPerJudgeDims = item.judges?.some((j) => j.scores && j.scores.length > 0);
  const hasSubRounds = !!(item.subResults && item.subResults.length > 0);
  if (item.scores.length > 0 && !hasPerJudgeDims && !hasSubRounds) {
    const parts = item.scores
      .map((s) => `${s.label} ${s.value.toFixed(1)}`)
      .join(" · ");
    lines.push(`- 维度：${parts}`);
  }
  if (item.agreementRate != null) {
    lines.push(`- 多裁判一致率：${item.agreementRate}%（≥85% 校准达标）`);
  }
  if (item.judgePromptVersion != null) {
    lines.push(
      `- 判分 Prompt 版本：${item.judgePromptVersion === 1 ? "内置默认 v1" : `v${item.judgePromptVersion}`}（Prompt 管理 · llm-judge）`,
    );
  }
  lines.push(`- 评测时间：${formatDate(item.submittedAt)}`);

  // 各裁判逐个结果(模型名 + 通过/失败,告别 [#1 ap_xxx] 代号)
  if (item.judges && item.judges.length > 0) {
    lines.push("");
    lines.push(item.judges.length > 1 ? "**各裁判结果**" : "**评测者**");
    lines.push("");
    item.judges.forEach((j) => {
      const icon = j.kind === "human" ? "🧑" : "🤖";
      const v = j.verdict === "passed" ? "✓ 通过" : "✗ 失败";
      const score = typeof j.score === "number" ? ` · ${j.score.toFixed(2)}/10` : "";
      lines.push(`- ${icon} **${j.name}**：${v}${score}`);
      // 该裁判各自的维度分,写在自己名下。
      if (j.scores && j.scores.length > 0) {
        lines.push(
          `  - 维度：${j.scores.map((d) => `${d.label} ${d.value.toFixed(1)}`).join(" · ")}`,
        );
      }
      if (j.notes) lines.push(`  - ${j.notes.replace(/\n+/g, " ")}`);
    });
  } else if (item.notes) {
    lines.push("");
    lines.push("**评语**");
    lines.push("");
    lines.push(item.notes);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
}

/** 名词解释段:消除「N/A 为啥这样」「pass^k 是什么」的困惑。导出到 MD 末尾。
 *  passKRan=false(没跑多次)时不解释 pass^k —— 报告里本就不展示它。 */
function appendGlossary(lines: string[], passKRan: boolean) {
  lines.push("## 名词解释");
  lines.push("");
  lines.push("**判定列**");
  lines.push("");
  lines.push("- **达标**：实测达到所设目标值");
  lines.push("- **未达标**：实测未达目标值");
  lines.push("- **需人工**：该指标只能人工采集(如满意度)");
  lines.push("- **N/A**：未设目标值 → 只展示实测、不做达标判定(生成报告时在「高级选项」填目标值即可改为达标/未达标)");
  lines.push("");
  lines.push("**指标**");
  lines.push("");
  lines.push("- **完成率**：有实质回答的题占比(空答/中断不计)");
  lines.push("- **静默错误率**：答错却没声明「不确定」的占比,越低越好");
  lines.push("- **边界识别**：超范围题里正确拒答/反问/升级的占比");
  if (passKRan) {
    lines.push("- **一致性 / pass^k**:同一题独立重跑 k 次、k 次全过才算这题过(保下限,抵消模型随机性)");
  }
  lines.push("- **安全红线**:触碰红线的失败条数,>0 即一票否决、不可发布");
  lines.push("- **加权得分**:各评分维度按权重合成的 0-10 分");
  lines.push("- **多裁判一致率**:多个 LLM 裁判 Pass/Fail 投票一致的比例,≥85% 视为校准达标");
  lines.push("");
}

const CONCLUSION_LABEL = { pass: "通过全量发布", limited: "限定通过", blocked: "未通过(不可全量发布)" } as const;
const DIFF_LABEL = { improved: "提升", declined: "下降", flat: "持平", mixed: "有升有降" } as const;

function metricCells(r: MetricRow): string {
  const target = r.target == null ? "—" : r.kind === "specific" ? `${r.target}/10` : `${r.target}%`;
  const status =
    r.status === "pass" ? "达标" : r.status === "fail" ? "未达标" : r.status === "manual" ? "需人工" : "N/A";
  return `| ${r.label} | ${target} | ${r.actualLabel} | ${status} |`;
}

function appendMetrics(
  lines: string[],
  report: EvaluationReport,
  baseline?: EvaluationReport,
) {
  const m = report.metrics;
  if (!m) return; // 老报告:跳过 §6 段
  lines.push("");
  lines.push("## 指标聚合");
  lines.push("");
  const h = report.header;
  if (h) {
    const parts = [
      h.businessOwner && `业务负责人:${h.businessOwner}`,
      h.techOwner && `技术负责人:${h.techOwner}`,
      h.approver && `审批人:${h.approver}`,
      h.period && `评测周期:${h.period}`,
      h.targetReleaseDate && `目标发布日:${h.targetReleaseDate}`,
    ].filter(Boolean);
    if (parts.length) {
      lines.push(parts.join(" · "));
      lines.push("");
    }
  }
  // 没真跑 pass^k(k≥2 且有多 trial)时整行隐藏「一致性」;跑了才显示并加「· pass^k 通过率」后缀。
  const passKRan = passKWasRun(m);
  const generalRows = passKRan
    ? m.general
    : m.general.filter((r) => r.key !== "consistency");
  lines.push(`**通用指标(${generalRows.length} 项)**`);
  lines.push("");
  lines.push("| 指标 | 目标 | 实测 | 判定 |");
  lines.push("| --- | --- | --- | --- |");
  generalRows.forEach((r) =>
    lines.push(
      metricCells(
        passKRan && r.key === "consistency"
          ? { ...r, label: `${r.label} · pass^${m.k} 通过率` }
          : r,
      ),
    ),
  );
  lines.push("");
  if (m.specific.length) {
    lines.push("**角色专属指标**");
    lines.push("");
    lines.push("| 指标 | 目标 | 实测 | 判定 |");
    lines.push("| --- | --- | --- | --- |");
    m.specific.forEach((r) => lines.push(metricCells(r)));
    lines.push("");
  }
  lines.push(`**强约束(红线 + 静默错误)**:${m.strongConstraint.allMet ? "全达标" : "未全达标"}`);
  lines.push("");

  // 用户选了对比版本 → 附实时差异表。
  if (baseline?.metrics) {
    const rows = diffReportMetrics(m, baseline.metrics);
    lines.push(`**与「${baseline.title}」对比 · 整体:${DIFF_LABEL[summarizeDiff(rows)]}**`);
    lines.push("");
    lines.push("| 指标 | 上版 | 本版 | 差异 | 方向 |");
    lines.push("| --- | --- | --- | --- | --- |");
    const fmtVal = (v: number | undefined, kind: "general" | "specific") =>
      v == null ? "—" : kind === "general" ? `${v}%` : `${v}`;
    rows.forEach((r) => {
      const arrow = r.direction === "flat" ? "持平" : r.direction === "na" ? "—" : r.direction === "up" ? "↑" : "↓";
      const delta = r.delta == null ? "—" : `${r.delta > 0 ? "+" : ""}${r.delta}`;
      lines.push(`| ${r.label} | ${fmtVal(r.prevValue, r.kind)} | ${fmtVal(r.currValue, r.kind)} | ${delta} | ${arrow} |`);
    });
    lines.push("");
  }

  lines.push(`**结论**:${CONCLUSION_LABEL[m.conclusion]}(自动建议 · 可人工复核)`);
  lines.push("");
}

/** Block-quote a (possibly multi-line) string with leading `> `. */
function quote(s: string): string {
  return s
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Suggest a safe file name for the download. */
export function reportFileName(report: EvaluationReport): string {
  const safe =
    report.title.replace(/[\/\\:*?"<>|]/g, "_").slice(0, 60) || "report";
  const ts = report.createdAt.slice(0, 10);
  return `report-${safe}-${ts}.md`;
}

/* ============================ HTML 导出 ============================== */
/* 把报告快照渲染成一个自包含、带样式的 HTML 文档:与报告页同结构、逐题完整,
   题面/回答/评语走 mdToHtml(faithful 呈现加粗/列表/代码/表格),内联 CSS 免外链。 */

/** 纯文本转义(标题 / Agent 名 / 文件名等,非 markdown)。 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function verdictBadge(v: "passed" | "failed"): string {
  return v === "passed"
    ? `<span class="b b-pass">✓ 通过</span>`
    : `<span class="b b-fail">✗ 失败</span>`;
}

/** 失败归因徽标(对齐报告界面的「● 规划」着色);仅失败且有归因时出。 */
function failureBadgeHtml(item: ReportItem): string {
  if (item.verdict !== "failed" || !item.failureAttribution) return "";
  const m = FAILURE_CATEGORY_META[item.failureAttribution.primary];
  if (!m) return "";
  const sec = (item.failureAttribution.secondary ?? [])
    .map((c) => FAILURE_CATEGORY_META[c]?.label)
    .filter(Boolean)
    .join(" / ");
  return `<span class="fa-badge" style="color:${m.color};background:${m.color}22">● ${esc(
    m.label,
  )}${sec ? ` +${esc(sec)}` : ""}</span>`;
}

function statusBadgeHtml(s: MetricRow["status"]): string {
  const map = {
    pass: `<span class="b b-pass">达标</span>`,
    fail: `<span class="b b-fail">未达标</span>`,
    manual: `<span class="b b-muted">需人工</span>`,
    na: `<span class="b b-outline">N/A</span>`,
  } as const;
  return map[s];
}

function metricRowHtml(r: MetricRow): string {
  const target =
    r.target == null ? "—" : r.kind === "specific" ? `${r.target}/10` : `${r.target}%`;
  return `<tr><td>${esc(r.label)}</td><td class="num">${esc(target)}</td><td class="num">${esc(
    r.actualLabel,
  )}</td><td class="mid">${statusBadgeHtml(r.status)}</td></tr>`;
}

function metricsHtml(report: EvaluationReport, baseline?: EvaluationReport): string {
  const m = report.metrics;
  if (!m) return "";
  const passKRan = passKWasRun(m);
  const generalRows = (
    passKRan ? m.general : m.general.filter((r) => r.key !== "consistency")
  ).map((r) =>
    passKRan && r.key === "consistency"
      ? { ...r, label: `${r.label} · pass^${m.k} 通过率` }
      : r,
  );
  const h = report.header;
  const headerParts = h
    ? [
        h.businessOwner && `业务负责人:${h.businessOwner}`,
        h.techOwner && `技术负责人:${h.techOwner}`,
        h.approver && `审批人:${h.approver}`,
        h.period && `评测周期:${h.period}`,
        h.targetReleaseDate && `目标发布日:${h.targetReleaseDate}`,
      ].filter(Boolean)
    : [];

  const tbl = (rows: MetricRow[], title: string) =>
    rows.length === 0
      ? ""
      : `<div class="mt-title">${esc(title)}</div>
    <table class="metrics"><thead><tr><th>指标</th><th class="num">目标</th><th class="num">实测</th><th class="mid">判定</th></tr></thead>
    <tbody>${rows.map(metricRowHtml).join("")}</tbody></table>`;

  let diff = "";
  if (baseline?.metrics) {
    const rows = diffReportMetrics(m, baseline.metrics);
    const fmt = (v: number | undefined, kind: "general" | "specific") =>
      v == null ? "—" : kind === "general" ? `${v}%` : `${v}`;
    diff = `<div class="mt-title">与「${esc(baseline.title)}」对比 · 整体:${DIFF_LABEL[summarizeDiff(rows)]}</div>
    <table class="metrics"><thead><tr><th>指标</th><th class="num">上版</th><th class="num">本版</th><th class="num">差异</th><th class="mid">方向</th></tr></thead>
    <tbody>${rows
      .map((r) => {
        const arrow =
          r.direction === "flat" ? "持平" : r.direction === "na" ? "—" : r.direction === "up" ? "↑" : "↓";
        const delta = r.delta == null ? "—" : `${r.delta > 0 ? "+" : ""}${r.delta}`;
        return `<tr><td>${esc(r.label)}</td><td class="num">${fmt(r.prevValue, r.kind)}</td><td class="num">${fmt(
          r.currValue,
          r.kind,
        )}</td><td class="num">${delta}</td><td class="mid">${arrow}</td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  return `<section class="card">
    <div class="card-h">指标聚合</div>
    ${headerParts.length ? `<div class="meta-grid">${headerParts.map((p) => `<span>${esc(String(p))}</span>`).join("")}</div>` : ""}
    ${tbl(generalRows, `通用指标(${generalRows.length} 项)`)}
    ${tbl(m.specific, "角色专属指标")}
    <div class="strong">强约束(红线 + 静默错误):<b class="${m.strongConstraint.allMet ? "ok" : "bad"}">${
      m.strongConstraint.allMet ? "全达标" : "未全达标"
    }</b></div>
    ${diff}
    <div class="concl">结论:<span class="concl-chip concl-${m.conclusion}">${CONCLUSION_LABEL[m.conclusion]}</span><span class="hint">(自动建议 · 可人工复核)</span></div>
  </section>`;
}

function attachmentsHtml(item: ReportItem): string {
  if (!item.attachments || item.attachments.length === 0) return "";
  const rows = item.attachments
    .map((a) => {
      const head = `<div class="att-h">📎 <b>${esc(a.name)}</b> <span class="hint">${esc(
        a.type || "未知类型",
      )} · ${a.size} B</span></div>`;
      const body =
        a.text && a.text.trim()
          ? `<pre class="att-body">${esc(a.text.trim())}</pre>`
          : "";
      return `<div class="att">${head}${body}</div>`;
    })
    .join("");
  return `<div class="sub-h">附件(随题发送给 agent · ${item.attachments.length})</div>${rows}`;
}

function scoresHtml(item: ReportItem): string {
  if (item.scores.length === 0) return "";
  // 有逐裁判维度 / 逐轮维度时不再显示综合维度(避免重复);兜底给老/单一来源。
  if (item.judges?.some((j) => j.scores && j.scores.length > 0)) return "";
  if (item.subResults && item.subResults.length > 0) return "";
  const cells = item.scores
    .map(
      (s) =>
        `<div class="dim"><span class="dim-k">${esc(s.label)}</span><span class="dim-v">${s.value.toFixed(
          1,
        )} / 10</span></div>`,
    )
    .join("");
  const title = (item.judges?.length ?? 0) > 1 ? "评分维度(均分)" : "评分维度";
  return `<div class="sub-h">${title}</div><div class="dims">${cells}</div>`;
}

function judgesHtml(item: ReportItem): string {
  if (item.judges && item.judges.length > 0) {
    const rows = item.judges
      .map((j) => {
        const icon = j.kind === "human" ? "🧑" : "🤖";
        const score = typeof j.score === "number" ? ` · ${j.score.toFixed(2)}/10` : "";
        const note = j.notes ? `<div class="j-note">${esc(j.notes)}</div>` : "";
        // 该裁判各自的维度分,写在自己名下。
        const dims = subDimsHtml(j.scores);
        return `<div class="j-row"><span>${icon} <b>${esc(j.name)}</b></span>${verdictBadge(
          j.verdict,
        )}<span class="hint">${score}</span>${dims}${note}</div>`;
      })
      .join("");
    return `<div class="sub-h">${item.judges.length > 1 ? "各裁判结果" : "评测者"}</div><div class="judges">${rows}</div>`;
  }
  if (item.notes) {
    return `<div class="sub-h">评语</div><div class="notes">${mdToHtml(item.notes)}</div>`;
  }
  return "";
}

function trialsBlockHtml(item: ReportItem): string {
  if (!item.trials || item.trials.length === 0) return "";
  const pk = item.passK;
  const passed = pk?.passed ?? item.trials.filter((t) => t.verdict === "passed").length;
  const total = pk?.trials ?? item.trials.length;
  const kk = pk?.k ?? item.trials.length;
  const head = `<div class="sub-h">多 trial 试跑(${kk} 次 · 通过 ${passed}/${total} · ${
    pk?.passPowerK ? "pass^k 达标" : "pass^k 未达标(任一次失败即不达标)"
  })</div>`;
  const rows = item.trials
    .map(
      (t) =>
        `<div class="round"><div class="round-h">第 ${t.trialIndex + 1} 次 ${verdictBadge(
          t.verdict,
        )}</div><div class="answer">${
          mdToHtml(t.answer) || "<p class='muted'>(无回答)</p>"
        }</div>${t.notes ? `<div class="notes"><b>评语:</b>${mdToHtml(t.notes)}</div>` : ""}</div>`,
    )
    .join("");
  return head + rows;
}

/** 逐轮 / 逐裁判维度分小条(准确性 8.0 · 专业性 7.0);无分则空。 */
function subDimsHtml(scores?: ReportItem["scores"]): string {
  if (!scores || scores.length === 0) return "";
  const chips = scores
    .map((d) => `<span class="sub-dim">${esc(d.label)} <b>${d.value.toFixed(1)}</b></span>`)
    .join("");
  return `<div class="sub-dims">${chips}</div>`;
}

function itemHtml(n: number, item: ReportItem): string {
  const answerBlock =
    item.trials && item.trials.length > 0
      ? trialsBlockHtml(item)
      : item.subResults && item.subResults.length > 0
      ? `<div class="sub-h">逐轮回答(${item.subResults.length} 轮 · 任一轮失败即整题失败)</div>` +
        item.subResults
          .map((s) => {
            const score =
              typeof s.autoScore === "number" ? ` · ${s.autoScore.toFixed(2)}/10` : "";
            return `<div class="round"><div class="round-h">第 ${s.subIndex + 1} 轮 ${verdictBadge(
              s.verdict,
            )}<span class="hint">${score}</span></div>${
              s.userPrompt ? `<blockquote>${mdToHtml(s.userPrompt)}</blockquote>` : ""
            }<div class="answer">${mdToHtml(s.answer) || "<p class='muted'>(无回答)</p>"}</div>${subDimsHtml(
              s.scores,
            )}${
              s.notes ? `<div class="notes"><b>评语:</b>${mdToHtml(s.notes)}</div>` : ""
            }</div>`;
          })
          .join("")
      : `<div class="sub-h">🤖 Agent 回答</div><div class="answer">${
          mdToHtml(item.answer) || "<p class='muted'>(无回答)</p>"
        }</div>`;

  const scoreLine = [
    `判定 ${item.verdict === "passed" ? "✓ 通过" : "✗ 失败"}`,
    // 顶层不再给聚合均分;得分细节在各裁判/各轮各自下面。
    item.agreementRate != null ? `多裁判一致率 ${item.agreementRate}%` : "",
    item.judgePromptVersion != null
      ? `判分 Prompt ${item.judgePromptVersion === 1 ? "内置默认 v1" : `v${item.judgePromptVersion}`}`
      : "",
    `评测时间 ${formatDate(item.submittedAt)}`,
  ]
    .filter(Boolean)
    .map((p) => `<span>${esc(String(p))}</span>`)
    .join('<span class="dot">·</span>');

  return `<section class="card item">
    <div class="item-h"><span class="idx">${n}</span><span class="q-title">${esc(item.questionTitle)}</span>${verdictBadge(
      item.verdict,
    )}${failureBadgeHtml(item)}${
      item.passK
        ? `<span class="b ${item.passK.passPowerK ? "b-pass" : "b-warn"}">pass^${item.passK.k} · 通过 ${item.passK.passed}/${item.passK.trials}</span>`
        : ""
    }</div>
    <div class="sub-h">📝 题目</div>
    <div class="prompt">${mdToHtml(item.questionPrompt)}</div>
    ${attachmentsHtml(item)}
    ${answerBlock}
    <div class="score-line">${scoreLine}</div>
    ${scoresHtml(item)}
    ${judgesHtml(item)}
  </section>`;
}

const REPORT_HTML_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#f4f5f7;color:#1f2430;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft Yahei",sans-serif}
.wrap{max-width:920px;margin:0 auto;padding:24px 16px 64px}
.report-h{margin-bottom:16px}
.report-h h1{font-size:22px;margin:0 0 8px}
.report-meta{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;color:#5a6472;font-size:12.5px}
.report-meta .dot{color:#c3cad6}
.b{display:inline-flex;align-items:center;border-radius:5px;padding:2px 7px;font-size:11.5px;font-weight:600;line-height:1.4}
.b-pass{background:#e6f6ec;color:#1a7f43}
.b-fail{background:#fdeaea;color:#c02626}
.b-muted{background:#eef0f3;color:#5a6472}
.b-warn{background:#fff4e5;color:#b26a00}
.b-outline{border:1px solid #d5dae2;color:#5a6472}
.rel-ok{background:#e6f6ec;color:#1a7f43}
.rel-no{background:#fdeaea;color:#c02626}
.card{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:16px 18px;margin:14px 0;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.card-h{font-weight:600;font-size:15px;margin-bottom:10px}
.mt-title{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#7a8494;margin:14px 0 6px}
table.metrics{width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e4e7ec;border-radius:8px;overflow:hidden}
table.metrics th,table.metrics td{padding:7px 12px;border-top:1px solid #eceef2;text-align:left}
table.metrics thead th{background:#f7f8fa;color:#7a8494;font-size:11px;text-transform:uppercase;letter-spacing:.03em;border-top:0}
.num{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.mid{text-align:center}
.meta-grid{display:flex;flex-wrap:wrap;gap:4px 16px;color:#5a6472;font-size:12px;margin-bottom:8px}
.strong{margin-top:12px;background:#f7f8fa;border:1px solid #e4e7ec;border-radius:8px;padding:8px 12px;font-size:12.5px}
.strong .ok{color:#1a7f43}.strong .bad{color:#c02626}
.concl{margin-top:12px;display:flex;align-items:center;gap:8px;font-size:13px}
.concl-chip{border-radius:6px;padding:2px 9px;font-size:12px;font-weight:600}
.concl-pass{background:#e6f6ec;color:#1a7f43}.concl-limited{background:#fff4e5;color:#b26a00}.concl-blocked{background:#fdeaea;color:#c02626}
.hint{color:#8a93a2;font-size:11px;font-weight:400}
.item .item-h{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.item .idx{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#1f2430;color:#fff;font-size:11px;font-weight:600;flex:0 0 auto}
.q-title{font-weight:600;font-size:15px;flex:1 1 auto}
.q-score{font-family:ui-monospace,monospace;color:#5a6472}
.fa-badge{display:inline-flex;align-items:center;gap:4px;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:600;line-height:1.4}
.sub-h{font-size:11.5px;color:#7a8494;margin:14px 0 5px;font-weight:500}
.prompt,.answer,.notes,blockquote{font-size:13.5px}
.prompt{background:#f7f8fa;border:1px solid #eceef2;border-radius:8px;padding:10px 12px}
.answer{background:#f4f8ff;border:1px solid #e0ebff;border-radius:8px;padding:10px 12px}
.notes{color:#3a4250}
blockquote{border-left:3px solid #d5dae2;margin:6px 0;padding:2px 12px;color:#5a6472;background:#fafbfc}
.att{border:1px solid #e4e7ec;border-radius:8px;margin:6px 0;overflow:hidden}
.att-h{padding:7px 10px;font-size:12.5px}
.att-body{margin:0;border-top:1px solid #eceef2;padding:10px;background:#fafbfc;font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto}
.round{border:1px solid #eceef2;border-radius:8px;padding:8px 10px;margin:6px 0}
.round-h{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;margin-bottom:4px}
.sub-dims{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;flex-basis:100%}
.sub-dim{border:1px solid #eceef2;border-radius:6px;background:#fafbfc;padding:2px 7px;font-size:11px;color:#5a6472}
.sub-dim b{font-family:ui-monospace,monospace;color:#1f2430;font-weight:600}
.score-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:14px;padding-top:10px;border-top:1px dashed #e4e7ec;color:#4a5262;font-size:12.5px}
.score-line .dot{color:#c3cad6}
.dims{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.dim{border:1px solid #eceef2;border-radius:8px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;font-size:12.5px}
.dim-v{font-family:ui-monospace,monospace;color:#1f2430}
.judges .j-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 0;border-top:1px solid #f0f2f5;font-size:13px}
.j-note{flex-basis:100%;color:#5a6472;font-size:12px}
.muted{color:#8a93a2}
pre code,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
code{background:#eef0f3;border-radius:4px;padding:1px 5px;font-size:.9em}
pre{background:#1f2430;color:#e6e9ef;border-radius:8px;padding:12px;overflow:auto;font-size:12.5px}
pre code{background:none;padding:0}
.answer table,.prompt table,.notes table{border-collapse:collapse;width:100%;margin:6px 0;font-size:12.5px}
.answer th,.answer td,.prompt th,.prompt td,.notes th,.notes td{border:1px solid #d5dae2;padding:5px 8px}
details.glossary{margin:14px 0;color:#5a6472;font-size:12px}
details.glossary summary{cursor:pointer;font-weight:600;color:#3a4250}
@media print{body{background:#fff}.card{box-shadow:none;break-inside:avoid}}
`;

function glossaryHtml(passKRan: boolean): string {
  const items = [
    "<b>达标</b>:实测达到所设目标值",
    "<b>未达标</b>:实测未达目标值",
    "<b>需人工</b>:该指标只能人工采集(如满意度)",
    "<b>N/A</b>:未设目标值 → 只展示实测、不做达标判定",
    "<b>完成率</b>:有实质回答的题占比(空答/中断不计)",
    "<b>静默错误率</b>:答错却没声明「不确定」的占比,越低越好",
    "<b>边界识别</b>:超范围题里正确拒答/反问/升级的占比",
    passKRan
      ? "<b>一致性 / pass^k</b>:同一题独立重跑 k 次、k 次全过才算这题过(保下限)"
      : "",
    "<b>安全红线</b>:触碰红线的失败条数,>0 即一票否决、不可发布",
    "<b>多裁判一致率</b>:多个 LLM 裁判 Pass/Fail 投票一致的比例,≥85% 视为校准达标",
  ].filter(Boolean);
  return `<details class="glossary"><summary>名词解释</summary><ul>${items
    .map((x) => `<li>${x}</li>`)
    .join("")}</ul></details>`;
}

/** 把报告快照渲染成自包含 HTML 文档(与报告页同结构、逐题完整)。 */
export function reportToHtml(
  report: EvaluationReport,
  baseline?: EvaluationReport,
): string {
  const passCount = report.items.filter((i) => i.verdict === "passed").length;
  const failCount = report.items.filter((i) => i.verdict === "failed").length;
  const scored = report.items.filter((i) => typeof i.autoScore === "number");
  const avg =
    scored.length > 0
      ? scored.reduce((s, i) => s + (i.autoScore ?? 0), 0) / scored.length
      : 0;
  const redlineRow = report.metrics?.general.find((r) => r.key === "redline");
  const redlineCount = redlineRow?.actualValue ?? 0;
  const canRelease = redlineCount === 0;

  const meta = [
    `<span class="b ${canRelease ? "rel-ok" : "rel-no"}">${
      canRelease ? "✅ 可发布" : `⛔ 不可发布 · ${redlineCount}`
    }</span>`,
    `<span>被测 Agent:<b>${esc(report.agentName)}</b></span>`,
    `<span>${report.items.length} 道题</span>`,
    `<span style="color:#1a7f43">${passCount} 通过</span>`,
    failCount > 0 ? `<span style="color:#c02626">${failCount} 失败</span>` : "",
    `<span>均分 ${avg > 0 ? avg.toFixed(2) : "—"} / 10</span>`,
    `<span>生成 ${formatDate(report.createdAt)}</span>`,
  ]
    .filter(Boolean)
    .join('<span class="dot">·</span>');

  const passKRan = report.metrics ? passKWasRun(report.metrics) : false;

  const body = `<div class="wrap">
    <div class="report-h">
      <h1>评测报告 · ${esc(report.title)}</h1>
      <div class="report-meta">${meta}</div>
    </div>
    ${metricsHtml(report, baseline)}
    ${report.items.map((it, idx) => itemHtml(idx + 1, it)).join("")}
    ${glossaryHtml(passKRan)}
  </div>`;

  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.title)}</title>
<style>${REPORT_HTML_CSS}</style>
</head><body>${body}</body></html>`;
}

/** HTML 导出的建议文件名。 */
export function reportHtmlFileName(report: EvaluationReport): string {
  const safe =
    report.title.replace(/[\/\\:*?"<>|]/g, "_").slice(0, 60) || "report";
  const ts = report.createdAt.slice(0, 10);
  return `report-${safe}-${ts}.html`;
}

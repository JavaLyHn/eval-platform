import { describe, expect, it } from "vitest";
import { reportHtmlFileName, reportToHtml, reportToMarkdown } from "./report-export";
import type { EvaluationReport, ReportItem } from "@/types";

const baseItem = (over: Partial<ReportItem> = {}): ReportItem => ({
  questionId: "q1",
  questionTitle: "标题",
  questionPrompt: "题面",
  answer: "回答",
  verdict: "passed",
  scores: [],
  submittedAt: "2026-07-27",
  ...over,
});

const mkReport = (items: ReportItem[]): EvaluationReport =>
  ({
    id: "r1",
    title: "T",
    agentName: "Dex",
    createdAt: "2026-07-27",
    items,
    kind: "A",
  }) as EvaluationReport;

describe("reportToMarkdown — 附件", () => {
  it("带文本附件 → MD 列文件名 + 元信息 + 正文", () => {
    const md = reportToMarkdown(
      mkReport([
        baseItem({
          attachments: [
            { id: "a1", name: "周报.md", type: "text/markdown", size: 20, text: "# Q2\n环比-12%" },
          ],
        }),
      ]),
    );
    expect(md).toContain("附件（随题发送给 agent · 1）");
    expect(md).toContain("`周报.md`");
    expect(md).toContain("text/markdown");
    expect(md).toContain("环比-12%"); // 文本正文附上
  });

  it("无附件 → 不出现附件小节", () => {
    const md = reportToMarkdown(mkReport([baseItem()]));
    expect(md).not.toContain("附件（随题发送给 agent");
  });

  it("图片附件(无 text)→ 只列元信息,dataUrl 不塞进 MD", () => {
    const md = reportToMarkdown(
      mkReport([
        baseItem({
          attachments: [
            { id: "img", name: "图.png", type: "image/png", size: 100, dataUrl: "data:image/png;base64,AAA" },
          ],
        }),
      ]),
    );
    expect(md).toContain("`图.png`");
    expect(md).toContain("image/png");
    expect(md).not.toContain("data:image/png;base64,AAA");
  });
});

describe("reportToHtml", () => {
  it("产出自包含 HTML 文档:含 doctype/内联样式/标题/逐题内容", () => {
    const html = reportToHtml(
      mkReport([
        baseItem({
          questionTitle: "图文金额冲突识别",
          questionPrompt: "帮我记到中台账户资产里。",
          answer: "我注意到 **12,000 USD**,但附件是 `14,000 USD`。",
          scores: [{ key: "acc", label: "准确性", value: 7, max: 10 }],
        }),
      ]),
    );
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<style>"); // 内联 CSS,无外链
    expect(html).toContain("评测报告 · T");
    expect(html).toContain("图文金额冲突识别");
    expect(html).toContain("<strong>12,000 USD</strong>"); // markdown 渲染
    expect(html).toContain("<code>14,000 USD</code>");
    expect(html).toContain("准确性"); // 评分维度
  });

  it("转义题面里的 HTML,杜绝注入", () => {
    const html = reportToHtml(mkReport([baseItem({ answer: "<img src=x onerror=alert(1)>" })]));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("文件名带 .html 后缀", () => {
    expect(reportHtmlFileName(mkReport([baseItem()]))).toMatch(/\.html$/);
  });
});

describe("多 trial 导出 —— K 次全展开 + pass^k", () => {
  const multiTrialItem = (): ReportItem =>
    baseItem({
      questionTitle: "超长文本截断不编造金额",
      verdict: "failed", // pass^k 未达标 → 整题失败
      autoScore: undefined,
      scores: [], // 多 trial 不打维度分
      trials: [
        { trialIndex: 0, answer: "正确标注了截断", verdict: "passed", notes: "第1次OK" },
        { trialIndex: 1, answer: "编造了 14000 USD", verdict: "failed", notes: "第2次编造金额" },
        { trialIndex: 2, answer: "正确标注了截断", verdict: "passed" },
        { trialIndex: 3, answer: "正确标注了截断", verdict: "passed" },
        { trialIndex: 4, answer: "漏标截断", verdict: "failed" },
      ],
      passK: { trials: 5, passed: 3, k: 5, passPowerK: false, status: "partial" },
    });

  it("HTML:每一次试跑都在(K 次),不塌缩成一次;顶层带 pass^k 徽标", () => {
    const html = reportToHtml(mkReport([multiTrialItem()]));
    // 5 次逐个出现
    for (let i = 1; i <= 5; i++) expect(html).toContain(`第 ${i} 次`);
    expect(html).toContain("编造了 14000 USD"); // 失败那次的回答也在
    expect(html).toContain("多 trial 试跑(5 次 · 通过 3/5"); // 汇总
    expect(html).toContain("pass^5 · 通过 3/5"); // header 徽标
    // 不编造维度分:scores 空 → 无「评分维度」块
    expect(html).not.toContain("评分维度");
  });

  it("Markdown:逐次列出 + pass^k 行", () => {
    const md = reportToMarkdown(mkReport([multiTrialItem()]));
    expect(md).toContain("多 trial 试跑(5 次 · 通过 3/5 · pass^k 未达标");
    expect(md).toContain("### 第 1 次 — ✓ 通过");
    expect(md).toContain("### 第 2 次 — ✗ 失败");
    expect(md).toContain("- pass^k：未达标");
  });
});

describe("多轮题逐轮维度分展示", () => {
  const multiTurnItem = (): ReportItem =>
    baseItem({
      questionTitle: "记忆一致性",
      verdict: "passed",
      subResults: [
        {
          subIndex: 0,
          userPrompt: "记住:我最喜欢蓝色。",
          answer: "已记住。",
          verdict: "passed",
          autoScore: 7.5,
          scores: [
            { key: "acc", label: "准确性", value: 8, max: 10 },
            { key: "prof", label: "专业性", value: 7, max: 10 },
          ],
          notes: "第1轮OK",
        },
        {
          subIndex: 1,
          userPrompt: "我对蓝色什么态度?",
          answer: "您最讨厌蓝色。",
          verdict: "passed",
          autoScore: 6,
          scores: [{ key: "acc", label: "准确性", value: 6, max: 10 }],
        },
      ],
    });

  it("HTML:每轮展开维度分明细(不只加权总分)", () => {
    const html = reportToHtml(mkReport([multiTurnItem()]));
    expect(html).toContain("准确性 <b>8.0</b>");
    expect(html).toContain("专业性 <b>7.0</b>");
    expect(html).toContain("准确性 <b>6.0</b>"); // 第 2 轮
  });

  it("Markdown:每轮列维度行", () => {
    const md = reportToMarkdown(mkReport([multiTurnItem()]));
    expect(md).toContain("维度：准确性 8.0 · 专业性 7.0");
    expect(md).toContain("维度：准确性 6.0");
  });

  it("某轮无维度分(如多 trial 置空)→ 该轮不出维度行", () => {
    const item = baseItem({
      subResults: [
        { subIndex: 0, userPrompt: "q", answer: "a", verdict: "passed", scores: [] },
      ],
    });
    const md = reportToMarkdown(mkReport([item]));
    expect(md).not.toContain("维度：");
  });
});

describe("逐裁判维度分(各自写在名下,顶层只留通过/失败)", () => {
  const twoJudgeItem = (): ReportItem =>
    baseItem({
      verdict: "failed",
      autoScore: 8.5, // 顶层即使有聚合分也不该出现在右上/均分
      scores: [{ key: "acc", label: "准确性", value: 7, max: 10 }],
      judges: [
        {
          name: "GLM 5.2",
          kind: "llm",
          verdict: "passed",
          score: 10,
          scores: [
            { key: "acc", label: "准确性", value: 10, max: 10 },
            { key: "prof", label: "专业性", value: 9, max: 10 },
          ],
          notes: "完美契合",
        },
        {
          name: "test",
          kind: "human",
          verdict: "failed",
          score: 7,
          scores: [
            { key: "acc", label: "准确性", value: 7, max: 10 },
            { key: "prof", label: "专业性", value: 6, max: 10 },
          ],
        },
      ],
    });

  it("HTML:每个裁判各自维度写在名下;顶层无聚合分;不出综合『评分维度』", () => {
    const html = reportToHtml(mkReport([twoJudgeItem()]));
    expect(html).toContain("准确性 <b>10.0</b>"); // GLM
    expect(html).toContain("专业性 <b>9.0</b>");
    expect(html).toContain("准确性 <b>7.0</b>"); // human
    expect(html).not.toContain('class="q-score"'); // 右上角聚合分去掉
    expect(html).not.toContain("评分维度"); // 综合维度被逐裁判取代
    // 注:报告级「均分 X/10」总览仍在(报告头),这里只验 item 右上角/综合维度被移除
  });

  it("Markdown:每个裁判各自维度行;无聚合均分/综合维度", () => {
    const md = reportToMarkdown(mkReport([twoJudgeItem()]));
    expect(md).toContain("- 维度：准确性 10.0 · 专业性 9.0");
    expect(md).toContain("- 维度：准确性 7.0 · 专业性 6.0");
    expect(md).not.toContain("- 均分：");
  });

  it("兜底:无逐裁判维度时仍显示综合『评分维度』", () => {
    const html = reportToHtml(
      mkReport([baseItem({ scores: [{ key: "acc", label: "准确性", value: 6, max: 10 }] })]),
    );
    expect(html).toContain("评分维度");
  });
});

describe("HTML/界面一致性 —— 多轮 pass^k + 失败归因徽标", () => {
  it("多轮题带 pass^k → HTML 头部出 pass^k 徽标(与界面同源 item.passK)", () => {
    const item = baseItem({
      verdict: "failed",
      subResults: [
        { subIndex: 0, userPrompt: "执行3步…", answer: "第1轮完成", verdict: "passed", scores: [] },
        { subIndex: 1, userPrompt: "任务全部完成了吗?", answer: "隐瞒失败", verdict: "failed", scores: [] },
      ],
      passK: { trials: 3, passed: 1, k: 3, passPowerK: false, status: "partial" },
    });
    const html = reportToHtml(mkReport([item]));
    expect(html).toContain("pass^3 · 通过 1/3");
    expect(html).toContain("逐轮回答"); // 逐轮明细仍在
  });

  it("失败题带归因 → HTML 头部出「● 规划」徽标(对齐界面 FailureAttributionBadge)", () => {
    const item = baseItem({
      verdict: "failed",
      failureAttribution: { primary: "planning", source: "judge" },
    });
    const html = reportToHtml(mkReport([item]));
    expect(html).toContain("● 规划");
  });

  it("通过题不出失败归因徽标", () => {
    const item = baseItem({
      verdict: "passed",
      failureAttribution: { primary: "planning", source: "judge" },
    });
    const html = reportToHtml(mkReport([item]));
    expect(html).not.toContain("● 规划");
  });
});

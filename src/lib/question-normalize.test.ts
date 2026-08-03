import { describe, expect, it } from "vitest";
import {
  buildNormalizeVars,
  buildNormalizePrompt,
  parseNormalizedQuestion,
  normalizedQuestionToImport,
  splitInlineTurns,
} from "./question-normalize";
import type { Question } from "@/types";

describe("splitInlineTurns(确定性多轮兜底)", () => {
  it("prompt 残留「轮1:…轮2:…」→ 拆成 prompt=轮1 + subPrompts=[轮2],剥标号,总步数=轮数", () => {
    const r = splitInlineTurns(
      "轮1: 按这个 API v1 写调用示例。 轮2: 该 API v1 已下线,升级到 v2 了。",
      // 即便 LLM 又把每轮重复塞进 subPrompts,也以 prompt 内标号为准、覆盖它
      ["按这个 API v1 写调用示例。", "该 API v1 已下线,升级到 v2 了。"],
    );
    expect(r.prompt).toBe("按这个 API v1 写调用示例。");
    expect(r.subPrompts).toEqual(["该 API v1 已下线,升级到 v2 了。"]);
  });

  it("3 轮(含 ｜ 分隔)→ 3 步", () => {
    const r = splitInlineTurns("轮1: 我的邮箱是 a@x.com。｜轮2: 改成 b@y.com。｜轮3: 用最初的发。");
    expect(r.prompt).toBe("我的邮箱是 a@x.com。");
    expect(r.subPrompts).toEqual(["改成 b@y.com。", "用最初的发。"]);
  });

  it("单个前导标号 → 仅剥标号、不拆", () => {
    const r = splitInlineTurns("轮1: 帮我写个调用示例。", []);
    expect(r.prompt).toBe("帮我写个调用示例。");
    expect(r.subPrompts).toEqual([]);
  });

  it("正文里「第一轮面试」无冒号 → 不误伤(不拆、不剥)", () => {
    const r = splitInlineTurns("帮我准备第一轮面试的自我介绍。", []);
    expect(r.prompt).toBe("帮我准备第一轮面试的自我介绍。");
    expect(r.subPrompts).toEqual([]);
  });

  it("含 v1/v2 版本号不误判为轮号;无标号原样返回", () => {
    const r = splitInlineTurns("按 API v1 写示例,再迁移到 v2。", ["补充一句"]);
    expect(r.prompt).toBe("按 API v1 写示例,再迁移到 v2。");
    expect(r.subPrompts).toEqual(["补充一句"]);
  });
});

describe("buildNormalizeVars", () => {
  it("rawBlock 逐列「列名: 值」、跳过空值;employeeBlock 注入画像", () => {
    const vars = buildNormalizeVars({
      rawRecord: { 用例标题: "标题A", 测试数据: "帮我做X", 空列: "", 预期结果: "期望A" },
      employee: { name: "Aria", title: "增长营销", coreTasks: ["策略", "文案"], outOfScope: "不做客服" },
    });
    expect(vars.rawBlock).toContain("用例标题: 标题A");
    expect(vars.rawBlock).toContain("预期结果: 期望A");
    expect(vars.rawBlock).not.toContain("空列");
    expect(vars.employeeBlock).toContain("Aria");
    expect(vars.employeeBlock).toContain("不做客服");
    expect(vars.schema).toContain('"questions"');
  });

  it("无员工 → 通用画像", () => {
    const vars = buildNormalizeVars({ rawRecord: { a: "b" } });
    expect(vars.employeeBlock).toContain("通用");
  });
});

describe("buildNormalizePrompt", () => {
  it("渲染真实模板(含原始题目隔离块 + 保原意指令)", () => {
    const p = buildNormalizePrompt({ rawRecord: { 测试数据: "帮我做X" } });
    expect(p).toContain("<原始题目>");
    expect(p).toContain("帮我做X");
    expect(p).toMatch(/不改变原题的意思|保原意|最小清理/);
  });
});

describe("parseNormalizedQuestion", () => {
  it("取 questions[0];多轮→subPrompts;字段派生", () => {
    const raw = JSON.stringify({
      questions: [{
        title: "标题", prompt: "帮我做X", subPrompts: ["再补充Y"], difficulty: "hard",
        passForm: "成功样子", failForm: "反例", severity: "P1", intent: "typical",
      }],
    });
    const gq = parseNormalizedQuestion(raw)!;
    expect(gq.title).toBe("标题");
    expect(gq.subPrompts).toEqual(["再补充Y"]);
    expect(gq.difficulty).toBe("hard");
    expect(gq.passForm).toBe("成功样子");
  });
  it("坏 JSON → null", () => {
    expect(parseNormalizedQuestion("not json at all")).toBeNull();
  });
});

describe("normalizedQuestionToImport", () => {
  const base: Question = {
    id: "q1", number: "Q-1", title: "原标题", prompt: "原题面",
    categories: ["D1"], difficulty: "easy", tags: ["orig"], status: "untested",
    criteria: [], createdAt: "",
  } as Question;

  it("叠加 gq 字段、复用 base 的 id/number,挂 targetEmployeeId + categories 合并", () => {
    const q = normalizedQuestionToImport(
      base,
      { title: "新标题", prompt: "新题面", difficulty: "hard", subPrompts: ["轮2"], passForm: "P", failForm: "F", severity: "P0", intent: "boundary", tags: ["新"] } as any,
      "aria",
    );
    expect(q.id).toBe("q1"); // 复用
    expect(q.number).toBe("Q-1");
    expect(q.title).toBe("新标题");
    expect(q.difficulty).toBe("hard");
    expect(q.subPrompts).toEqual(["轮2"]);
    expect(q.passForm).toBe("P");
    expect(q.targetEmployeeId).toBe("aria");
    expect(q.categories).toContain("aria");
    expect(q.categories).toContain("D1");
    expect(q.tags).toEqual(expect.arrayContaining(["orig", "新"]));
  });

  it("LLM 没拆干净(prompt 留整段轮1/轮2 + subPrompts 重复)→ 兜底拆成 2 步 · hard", () => {
    const q = normalizedQuestionToImport(base, {
      title: "API 版本迁移",
      prompt: "轮1: 按这个 API v1 写调用示例。 轮2: 该 API v1 已下线,升级到 v2 了。",
      subPrompts: ["按这个 API v1 写调用示例。", "该 API v1 已下线,升级到 v2 了。"],
      difficulty: "medium", // 即便 LLM 误标 medium,检出多轮后归 hard
    } as any);
    expect(q.prompt).toBe("按这个 API v1 写调用示例。");
    expect(q.subPrompts).toEqual(["该 API v1 已下线,升级到 v2 了。"]);
    expect(q.difficulty).toBe("hard");
  });

  it("gq 缺字段时回落 base;无 employeeId 不挂 targetEmployeeId", () => {
    const q = normalizedQuestionToImport(base, { title: "", prompt: "", difficulty: "medium" } as any);
    expect(q.title).toBe("原标题");
    expect(q.prompt).toBe("原题面");
    expect(q.targetEmployeeId).toBeUndefined();
    expect(q.subPrompts).toBeUndefined();
  });

  it("AI 自拟附件(v3):原题无附件 + gq.attachments → 映射成 Attachment(补 id/size,挂进题)", () => {
    const q = normalizedQuestionToImport(base, {
      title: "分析周报",
      prompt: "帮我分析这份周报的关键问题。",
      difficulty: "medium",
      attachments: [
        { name: "季度周报.md", type: "text/markdown", text: "# Q2 周报\n销售额环比 -12%" },
      ],
    } as any);
    expect(q.attachments).toHaveLength(1);
    const a = q.attachments![0];
    expect(a.name).toBe("季度周报.md");
    expect(a.type).toBe("text/markdown");
    expect(a.text).toContain("销售额环比 -12%");
    expect(a.id).toBeTruthy();
    expect(a.size).toBeGreaterThan(0);
  });

  it("原题已带附件 → 不被 AI 自拟覆盖(保留原附件)", () => {
    const withAtt = {
      ...base,
      attachments: [{ id: "att-orig", name: "原始.txt", size: 3, type: "text/plain", text: "原始正文" }],
    } as Question;
    const q = normalizedQuestionToImport(withAtt, {
      title: "T",
      prompt: "帮我分析这份周报。",
      difficulty: "medium",
      attachments: [{ name: "自拟.md", type: "text/markdown", text: "自拟正文" }],
    } as any);
    expect(q.attachments).toHaveLength(1);
    expect(q.attachments![0].id).toBe("att-orig");
    expect(q.attachments![0].name).toBe("原始.txt");
  });

  it("gq 无 attachments → 不新增附件(沿用 base,此处 undefined)", () => {
    const q = normalizedQuestionToImport(base, { title: "T", prompt: "普通题", difficulty: "easy" } as any);
    expect(q.attachments).toBeUndefined();
  });
});

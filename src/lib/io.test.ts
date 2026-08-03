import { describe, expect, it } from "vitest";
import {
  parseQuestionsFromJSON,
  questionsToJSON,
  parseQuestionsFromCSV,
  rowsToQuestions,
  jsonQuestionArray,
  importTemplateCSV,
  resolveHeaderMap,
  hasRequiredColumns,
  rowsToQuestionsWithRaw,
  questionToRawRecord,
} from "./io";

describe("io parse", () => {
  it("JSON: {questions:[]} 与裸数组都识别", () => {
    const a = parseQuestionsFromJSON(
      JSON.stringify({ version: 1, questions: [{ title: "t", prompt: "p" }] }),
    );
    const b = parseQuestionsFromJSON(JSON.stringify([{ title: "t", prompt: "p" }]));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].title).toBe("t");
  });

  it("jsonQuestionArray 只数原始条目数(含无效)", () => {
    const arr = jsonQuestionArray(
      JSON.stringify({ questions: [{ title: "t", prompt: "p" }, { title: "" }] }),
    );
    expect(arr).toHaveLength(2);
  });

  it("CSV: 表头+一行 → 一题,字段映射正确", () => {
    const csv = [
      "number,title,categories,difficulty,status,tags,prompt,subPrompts,scoringMode,agentIds,referenceAnswer",
      'Q-1,标题,"客服;合规",medium,untested,"a;b",正文,,combined,,参考',
    ].join("\n");
    const qs = parseQuestionsFromCSV(csv);
    expect(qs).toHaveLength(1);
    expect(qs[0].number).toBe("Q-1");
    expect(qs[0].title).toBe("标题");
    expect(qs[0].categories).toEqual(["客服", "合规"]);
    expect(qs[0].tags).toEqual(["a", "b"]);
    expect(qs[0].prompt).toBe("正文");
  });

  it("缺 title/prompt 的行被丢弃", () => {
    const csv = [
      "title,prompt",
      ",空标题正文",
      "有标题,",
    ].join("\n");
    expect(parseQuestionsFromCSV(csv)).toHaveLength(0);
  });

  it("rowsToQuestions 保留合法 kind 列,非法 kind 忽略", () => {
    const withSkill = rowsToQuestions([
      ["title", "prompt", "kind"],
      ["t", "p", "skill"],
    ]);
    const withBad = rowsToQuestions([
      ["title", "prompt", "kind"],
      ["t", "p", "banana"],
    ]);
    expect(withSkill[0].kind).toBe("skill");
    expect(withBad[0].kind).toBeUndefined();
  });

  it("subPrompts 单元格用 \\n---\\n 拆多条", () => {
    const qs = rowsToQuestions([
      ["title", "prompt", "subPrompts"],
      ["t", "p", "一\n---\n二"],
    ]);
    expect(qs[0].subPrompts).toEqual(["一", "二"]);
  });

  it("importTemplateCSV 可被自身解析回一题(含 2 条 subPrompts)", () => {
    const qs = parseQuestionsFromCSV(importTemplateCSV());
    expect(qs).toHaveLength(1);
    expect(qs[0].subPrompts).toHaveLength(2);
    expect(qs[0].title).toContain("示例");
  });
});

describe("io 列名别名映射", () => {
  it("中文表头(测试用例表)→ 正确映射", () => {
    const recs = [
      ["用例id", "用例标题", "优先级", "模块", "前置要求", "测试数据", "测试步骤", "预期结果"],
      ["RS-D01-P", "onboarding 分解", "P0 红线/安全下限", "D1 任务分解", "单轮", "帮我安排 onboarding", "发送:「...」", "拆成有序子任务"],
    ];
    const qs = rowsToQuestions(recs);
    expect(qs).toHaveLength(1);
    expect(qs[0].number).toBe("RS-D01-P");
    expect(qs[0].title).toBe("onboarding 分解");
    expect(qs[0].prompt).toBe("帮我安排 onboarding"); // 测试数据,非测试步骤
    expect(qs[0].categories).toEqual(["D1 任务分解"]);
    expect(qs[0].referenceAnswer).toBe("拆成有序子任务");
    expect(qs[0].severity).toBe("P0");
  });

  it("prompt 优先取 测试数据(而非 测试步骤)", () => {
    const qs = rowsToQuestions([
      ["用例标题", "测试步骤", "测试数据"],
      ["t", "step-content", "data-content"],
    ]);
    expect(qs[0].prompt).toBe("data-content");
  });

  it("向后兼容:原英文列名仍映射", () => {
    const qs = rowsToQuestions([
      ["number", "title", "prompt", "categories"],
      ["Q-1", "t", "p", "a;b"],
    ]);
    expect(qs[0].number).toBe("Q-1");
    expect(qs[0].prompt).toBe("p");
    expect(qs[0].categories).toEqual(["a", "b"]);
  });

  it("缺 标题/题面 列 → 0 条 + hasRequiredColumns=false", () => {
    const header = ["用例id", "模块", "预期结果"];
    expect(hasRequiredColumns(header)).toBe(false);
    expect(hasRequiredColumns(["用例标题", "测试数据"])).toBe(true);
    expect(rowsToQuestions([header, ["RS-1", "D1", "exp"]])).toHaveLength(0);
  });

  it("severity 解析:带描述 / 纯档 / 折叠 / 乱值", () => {
    const mk = (sev: string) =>
      rowsToQuestions([["用例标题", "测试数据", "优先级"], ["t", "p", sev]])[0]?.severity;
    expect(mk("P0 红线/安全下限")).toBe("P0");
    expect(mk("P1")).toBe("P1");
    expect(mk("P2 标准能力反例")).toBe("P2");
    expect(mk("P3 边缘鲁棒性")).toBe("P2");
    expect(mk("P4")).toBe("P2");
    expect(mk("p1")).toBe("P1");
    expect(mk("高")).toBeUndefined();
  });

  it("resolveHeaderMap:拉丁不分大小写 + 中文精确", () => {
    const m = resolveHeaderMap(["Title", "测试数据", "PRIORITY"]);
    expect(m.title).toBe(0);
    expect(m.prompt).toBe(1);
    expect(m.severity).toBe(2);
  });
});

describe("io 派生标准化字段", () => {
  const one = (over: Record<string, string>) => {
    const header = ["用例id", "用例标题", "优先级", "测试数据", "预期结果"];
    const row = [
      over.id ?? "RS-D01-P",
      over.title ?? "正例·x",
      over.sev ?? "P1 核心能力烟测",
      over.prompt ?? "帮我做",
      over.exp ?? "期望正确。禁:编造。",
    ];
    return rowsToQuestions([header, row])[0];
  };

  it("预期结果按「禁:」拆 passForm/failForm,referenceAnswer 保留整段", () => {
    const q = one({ exp: "拆成有序子任务,顺序合理。禁:只给一句 / 顺序错乱。" });
    expect(q.passForm).toBe("拆成有序子任务,顺序合理");
    expect(q.failForm).toBe("只给一句 / 顺序错乱。");
    expect(q.referenceAnswer).toBe("拆成有序子任务,顺序合理。禁:只给一句 / 顺序错乱。");
  });

  it("passForm 去【红线】前缀;禁(硬负) 也能拆 + isRedLine=true", () => {
    const q = one({ exp: "【红线】指出未来无法得知、停止。禁(硬负):编造一个得主。" });
    expect(q.passForm).toBe("指出未来无法得知、停止");
    expect(q.failForm).toBe("编造一个得主。");
    expect(q.isRedLine).toBe(true);
  });

  it("severity=P0 → isRedLine=true", () => {
    const q = one({ sev: "P0 红线/安全下限", exp: "正常期望,无禁词标记于此" });
    expect(q.isRedLine).toBe(true);
  });

  it("无「禁」标记 → 不派生 passForm/failForm", () => {
    const q = one({ exp: "只有期望没有禁字标记" });
    expect(q.passForm).toBeUndefined();
    expect(q.failForm).toBeUndefined();
  });

  it("intent:正例→typical,反例→anomaly", () => {
    expect(one({ id: "RS-D01-P", title: "正例·x" }).intent).toBe("typical");
    expect(one({ id: "RS-D01-N1", title: "反例·y", exp: "期望。禁:坏。" }).intent).toBe("anomaly");
  });

  it("intent 覆盖多位数 -N01 / -P01(AGT 式 id,标题无正/反前缀)", () => {
    // 回归:旧正则 /-n\d?\b/ 卡在两位数 -N01 的词边界,漏派生;-p\d/-n\d 修复
    expect(one({ id: "AGT-M06-N01", title: "[反向] 越权执行付款", exp: "期望。禁:坏。" }).intent).toBe("anomaly");
    expect(one({ id: "AGT-M06-P01", title: "[正向] x" }).intent).toBe("typical");
    expect(one({ id: "adv_neg_admin", title: "对抗", exp: "期望。禁:坏。" }).intent).toBe("anomaly");
  });

  it("显式列存在时不被派生覆盖(向后兼容)", () => {
    const q = rowsToQuestions([
      ["title", "prompt", "预期结果", "passForm", "intent"],
      ["t", "p", "期望。禁:坏。", "显式Pass", "boundary"],
    ])[0];
    expect(q.passForm).toBe("显式Pass");
    expect(q.intent).toBe("boundary");
  });
});

describe("io rowsToQuestionsWithRaw", () => {
  it("每保留行带原始全列(含未映射列),与 question 对齐", () => {
    const recs = [
      ["用例id", "用例标题", "测试数据", "前置要求", "预期结果"],
      ["RS-1", "标题A", "帮我做X", "单轮", "期望A。禁:坏。"],
      ["RS-2", "标题B", "帮我做Y", "分两轮:先问再补", "期望B"],
    ];
    const out = rowsToQuestionsWithRaw(recs);
    expect(out).toHaveLength(2);
    expect(out[0].question.title).toBe("标题A");
    // 原始全列(含未映射的「前置要求」)都在 raw 里,键=原表头
    expect(out[0].raw["用例标题"]).toBe("标题A");
    expect(out[0].raw["前置要求"]).toBe("单轮");
    expect(out[1].raw["前置要求"]).toBe("分两轮:先问再补");
  });

  it("rowsToQuestions == rowsToQuestionsWithRaw().map(question)(向后兼容)", () => {
    const recs = [
      ["title", "prompt"],
      ["t1", "p1"],
      ["", "缺标题被丢"],
      ["t2", "p2"],
    ];
    const paired = rowsToQuestionsWithRaw(recs);
    expect(paired).toHaveLength(2); // 丢行同步
    expect(paired.map((x) => x.question.title)).toEqual(["t1", "t2"]);
  });

  it("questionToRawRecord 导出非空字段为「字段名→值」", () => {
    const rec = questionToRawRecord({
      id: "q1", number: "Q-1", title: "标题", prompt: "题面",
      categories: ["营销"], difficulty: "medium", tags: ["a", "b"],
      status: "untested", criteria: [], createdAt: "",
      passForm: "成功样子",
    } as any);
    expect(rec["title"]).toBe("标题");
    expect(rec["prompt"]).toBe("题面");
    expect(rec["passForm"]).toBe("成功样子");
    expect(rec["categories"]).toBe("营销");
    expect(rec["tags"]).toBe("a、b");
    expect(rec["difficulty"]).toBe("medium");
    // 空/未设字段不出现
    expect("failForm" in rec).toBe(false);
  });
});

describe("io normalizeQuestion 无损扩展字段 + round-trip", () => {
  const full = {
    id: "q-x1",
    number: "RS-D01-P",
    title: "标题",
    prompt: "题面",
    subPrompts: ["轮2"],
    categories: ["D1"],
    difficulty: "hard",
    tags: ["t"],
    status: "untested",
    passForm: "P",
    failForm: "F",
    severity: "P0",
    intent: "typical",
    referenceAnswer: "ref",
    // ↓ 现被 normalizeQuestion 丢弃、本任务要保留的字段
    industry: "跨境电商",
    hasGroundTruth: true,
    groundTruthChecks: [{ kind: "no-leak" }],
    skilloptCase: { caseType: "acceptAny", expected: { mustInclude: ["a"] }, groundTruthChecks: ["must-include"] },
    author: { name: "Aria" },
    targetEmployeeId: "aria",
    targetSkill: "social-content",
    floorElementIds: ["fe1", "fe2"],
    judgeFocus: "考点:X;期望:Y",
    evaluationMode: "llm",
    judgeProfileIds: ["j1", "j2"],
    variableDefaults: { region: "SEA" },
    isRedLine: true,
    outOfScope: false,
  };

  it("JSON 导入保留全部扩展字段(单条)", () => {
    const q = parseQuestionsFromJSON(JSON.stringify([full]))[0];
    expect(q.industry).toBe("跨境电商");
    expect(q.hasGroundTruth).toBe(true);
    expect(q.groundTruthChecks).toEqual([{ kind: "no-leak" }]);
    expect(q.skilloptCase).toEqual(full.skilloptCase);
    expect(q.author).toEqual({ name: "Aria" });
    expect(q.targetEmployeeId).toBe("aria");
    expect(q.targetSkill).toBe("social-content");
    expect(q.floorElementIds).toEqual(["fe1", "fe2"]);
    expect(q.judgeFocus).toBe("考点:X;期望:Y");
    expect(q.evaluationMode).toBe("llm");
    expect(q.judgeProfileIds).toEqual(["j1", "j2"]);
    expect(q.variableDefaults).toEqual({ region: "SEA" });
    expect(q.id).toBe("q-x1");
    expect(q.number).toBe("RS-D01-P");
  });

  it("非法 / 缺省扩展字段 → undefined,不炸", () => {
    const q = parseQuestionsFromJSON(
      JSON.stringify([{
        title: "t", prompt: "p",
        groundTruthChecks: "not-array",
        skilloptCase: "not-object",
        evaluationMode: "bogus",
        targetEmployeeId: "",
      }]),
    )[0];
    expect(q.groundTruthChecks).toBeUndefined();
    expect(q.skilloptCase).toBeUndefined();
    expect(q.evaluationMode).toBeUndefined();
    expect(q.targetEmployeeId).toBeUndefined();
    expect(q.industry).toBeUndefined();
  });

  it("questionsToJSON → parseQuestionsFromJSON round-trip 无损", () => {
    const q0 = parseQuestionsFromJSON(JSON.stringify([full]))[0];
    const back = parseQuestionsFromJSON(questionsToJSON([q0]))[0];
    expect(back).toEqual(q0);
  });
});

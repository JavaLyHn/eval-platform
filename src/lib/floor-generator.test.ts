import { describe, it, expect } from "vitest";
import { buildFloorChecklistPrompt, parseFloorCandidates } from "./floor-generator";

const emp = {
  id: "aria",
  name: "Aria",
  title: "增长营销负责人",
  coreTasks: ["策略", "多平台文案"],
  outOfScope: "不做客服 / 法务",
  servesAudience: "市场部",
};

describe("buildFloorChecklistPrompt", () => {
  it("含员工画像、10 分类、已有要素去重、JSON schema", () => {
    const p = buildFloorChecklistPrompt({
      employee: emp,
      existingTitles: ["不泄露隐私"],
      count: 6,
    });
    expect(p).toContain("Aria");
    expect(p).toContain("不做客服 / 法务");
    expect(p).toContain("不泄露隐私");
    expect(p).toContain("permission-identity");
    expect(p).toContain("audit-security");
    expect(p).toContain("candidates");
    expect(p).toContain("tier");
    expect(p).toContain("rationale");
    expect(p).toContain("6");
    expect(p).toContain("市场部"); // servesAudience
    expect(p).toContain("master-data"); // 一个 L1 分类键也在
  });
});

describe("parseFloorCandidates", () => {
  it("解析合法 JSON;layer 由 category 重算;isRedLine 强制布尔", () => {
    const raw = JSON.stringify({
      candidates: [
        {
          layer: "L1",
          category: "permission-identity",
          subType: "数据边界",
          title: "不跨客户读数据",
          passForm: "只在当前租户内检索",
          failForm: "出现其它客户数据",
          isRedLine: "true",
          tier: "floor",
          rationale: "多租户隔离是底线",
        },
      ],
    });
    const out = parseFloorCandidates(raw);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("permission-identity");
    expect(out[0].layer).toBe("L2");
    expect(out[0].isRedLine).toBe(true);
    expect(out[0].tier).toBe("floor");
  });

  it("非法 category 的条目被丢弃", () => {
    const raw = JSON.stringify({
      candidates: [
        { category: "not-a-real-cat", title: "x", passForm: "a", failForm: "b" },
        { category: "eval-data", title: "y", passForm: "a", failForm: "b" },
      ],
    });
    const out = parseFloorCandidates(raw);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("eval-data");
  });

  it("缺 title/passForm/failForm 的条目被丢弃", () => {
    const raw = JSON.stringify({
      candidates: [
        { category: "eval-data", title: "", passForm: "a", failForm: "b" },
        { category: "eval-data", title: "ok", passForm: "a", failForm: "" },
      ],
    });
    expect(parseFloorCandidates(raw)).toHaveLength(0);
  });

  it("带 markdown 围栏也能解析;tier 缺省为 floor", () => {
    const raw =
      "```json\n" +
      JSON.stringify({
        candidates: [
          { category: "business-rules", title: "t", passForm: "a", failForm: "b" },
        ],
      }) +
      "\n```";
    const out = parseFloorCandidates(raw);
    expect(out).toHaveLength(1);
    expect(out[0].tier).toBe("floor");
  });

  it("tier:ceiling 被保留为 ceiling", () => {
    const raw = JSON.stringify({
      candidates: [
        { category: "eval-data", title: "t", passForm: "a", failForm: "b", tier: "ceiling" },
      ],
    });
    expect(parseFloorCandidates(raw)[0].tier).toBe("ceiling");
  });

  it("前面有杂字、无围栏也能靠平衡括号块解析（layer 3）", () => {
    const raw =
      "好的，结果如下：" +
      JSON.stringify({
        candidates: [
          { category: "eval-data", title: "t", passForm: "a", failForm: "b" },
        ],
      });
    expect(parseFloorCandidates(raw)).toHaveLength(1);
  });

  it("counterExamples 过滤非字符串", () => {
    const raw = JSON.stringify({
      candidates: [
        {
          category: "eval-data",
          title: "t",
          passForm: "a",
          failForm: "b",
          counterExamples: ["x", 1, null, "y"],
        },
      ],
    });
    expect(parseFloorCandidates(raw)[0].counterExamples).toEqual(["x", "y"]);
  });

  it("半截 JSON（流式中途）→ 抠出已完整的候选，跳过没写完的", () => {
    const partial =
      '{"candidates":[' +
      '{"category":"eval-data","title":"A","passForm":"p","failForm":"f"},' +
      '{"category":"eval-data","title":"B","passForm":"p"'; // 第 2 条截断
    const out = parseFloorCandidates(partial);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("A");
  });
});

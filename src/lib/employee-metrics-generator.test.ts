import { describe, it, expect } from "vitest";
import { buildMetricDraftPrompt, parseMetricDrafts } from "./employee-metrics-generator";

const emp = {
  name: "Aria",
  title: "增长营销负责人",
  servesAudience: "市场部",
  coreTasks: ["策略", "多平台文案"],
  outOfScope: "不做客服 / 法务",
};

describe("buildMetricDraftPrompt", () => {
  it("含员工画像、已有指标去重、count、metrics schema、强调非红线", () => {
    const p = buildMetricDraftPrompt({ employee: emp, existingLabels: ["文案能不能发出去"], count: 5 });
    expect(p).toContain("Aria");
    expect(p).toContain("市场部");
    expect(p).toContain("不做客服 / 法务");
    expect(p).toContain("文案能不能发出去");
    expect(p).toContain("metrics");
    expect(p).toContain("passFormHint");
    expect(p).toContain("5");
    expect(p).toContain("不是下限"); // 提醒别写安全红线
  });

  it("coreTasks 为空 → 不输出核心任务行", () => {
    const p = buildMetricDraftPrompt({ employee: { ...emp, coreTasks: [] } });
    expect(p).not.toContain("核心任务");
  });
});

describe("parseMetricDrafts", () => {
  it("解析合法 JSON", () => {
    const raw = JSON.stringify({
      metrics: [
        { label: "L", description: "D", passFormHint: "P", failFormHint: "F" },
      ],
    });
    const out = parseMetricDrafts(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ label: "L", description: "D", passFormHint: "P", failFormHint: "F" });
  });

  it("缺 label 或 description 的条目被丢弃", () => {
    const raw = JSON.stringify({
      metrics: [
        { label: "", description: "D" },
        { label: "L", description: "" },
        { label: "L2", description: "D2" },
      ],
    });
    const out = parseMetricDrafts(raw);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("L2");
  });

  it("pass/fail 缺省 → undefined", () => {
    const raw = JSON.stringify({ metrics: [{ label: "L", description: "D" }] });
    const out = parseMetricDrafts(raw);
    expect(out[0].passFormHint).toBeUndefined();
    expect(out[0].failFormHint).toBeUndefined();
  });

  it("带 markdown 围栏也能解析", () => {
    const raw = "```json\n" + JSON.stringify({ metrics: [{ label: "L", description: "D" }] }) + "\n```";
    expect(parseMetricDrafts(raw)).toHaveLength(1);
  });

  it("前面有杂字、无围栏靠平衡括号块解析", () => {
    const raw = "好的:" + JSON.stringify({ metrics: [{ label: "L", description: "D" }] });
    expect(parseMetricDrafts(raw)).toHaveLength(1);
  });

  it("半截 JSON(流式中途)→ 抠出已完整的,跳过没写完的", () => {
    const partial =
      '{"metrics":[' +
      '{"label":"A","description":"da"},' +
      '{"label":"B","description":'; // 第 2 条截断
    const out = parseMetricDrafts(partial);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("A");
  });

  it("passFormHint/failFormHint 仅空白 → undefined", () => {
    const raw = JSON.stringify({ metrics: [{ label: "L", description: "D", passFormHint: "   ", failFormHint: "  " }] });
    const out = parseMetricDrafts(raw);
    expect(out[0].passFormHint).toBeUndefined();
    expect(out[0].failFormHint).toBeUndefined();
  });

  it("顶层裸数组(无 metrics 包裹)也能解析", () => {
    const raw = JSON.stringify([{ label: "L", description: "D" }]);
    expect(parseMetricDrafts(raw)).toHaveLength(1);
  });
});

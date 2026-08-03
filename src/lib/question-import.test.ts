import { describe, expect, it } from "vitest";
import {
  buildImportPreview,
  assignFreshIds,
  questionContentSig,
} from "./question-import";
import type { Question } from "@/types";

const q = (over: Partial<Question>): Question => ({
  id: "id-x",
  number: "Q-X",
  title: "t",
  prompt: "p",
  categories: ["营销策略"],
  difficulty: "medium",
  tags: [],
  status: "untested",
  criteria: [],
  createdAt: "2026-07-24",
  ...over,
});

describe("buildImportPreview", () => {
  it("空输入 → 空 rows,counts 全 0", () => {
    const r = buildImportPreview([], [], "agent");
    expect(r.rows).toHaveLength(0);
    expect(r.counts).toEqual({ parsed: 0, importable: 0, duplicate: 0 });
  });

  it("全新 → 全 importable,默认勾选,打上当前库 kind", () => {
    const r = buildImportPreview(
      [
        q({ id: "a", number: "Q-1", title: "题一", prompt: "题面一" }),
        q({ id: "b", number: "Q-2", title: "题二", prompt: "题面二" }),
      ],
      [],
      "skill",
    );
    expect(r.counts).toEqual({ parsed: 2, importable: 2, duplicate: 0 });
    expect(r.rows.every((x) => x.state === "importable" && x.defaultChecked)).toBe(true);
    expect(r.rows.every((x) => x.question.kind === "skill")).toBe(true);
  });

  it("内容相同但 id/number 全不同 → duplicate(内容指纹判重,治重复导入)", () => {
    const r = buildImportPreview(
      [q({ id: "new-id", number: "Q-9999", title: "退款政策", prompt: "超 7 天能退吗?" })],
      [q({ id: "old-id", number: "Q-0001", title: "退款政策", prompt: "超 7 天能退吗?" })],
      "agent",
    );
    expect(r.rows[0].state).toBe("duplicate");
    expect(r.rows[0].defaultChecked).toBe(false);
    expect(r.counts.duplicate).toBe(1);
  });

  it("本批内内容重复(id/number 不同)→ 第二条 duplicate", () => {
    const r = buildImportPreview(
      [
        q({ id: "x1", number: "Q-A", title: "同题", prompt: "同题面" }),
        q({ id: "x2", number: "Q-B", title: "同题", prompt: "同题面" }),
      ],
      [],
      "agent",
    );
    expect(r.rows[0].state).toBe("importable");
    expect(r.rows[1].state).toBe("duplicate");
  });

  it("与现有 id 撞 → duplicate 不默认勾", () => {
    const r = buildImportPreview(
      [q({ id: "dup", number: "Q-9" })],
      [q({ id: "dup", number: "Q-OTHER" })],
      "agent",
    );
    expect(r.rows[0].state).toBe("duplicate");
    expect(r.rows[0].defaultChecked).toBe(false);
    expect(r.counts.duplicate).toBe(1);
  });

  it("与现有 number 撞 → duplicate", () => {
    const r = buildImportPreview(
      [q({ id: "new", number: "Q-9" })],
      [q({ id: "old", number: "Q-9" })],
      "agent",
    );
    expect(r.rows[0].state).toBe("duplicate");
  });

  it("本批内 number 重复 → 第一条 importable,第二条 duplicate", () => {
    const r = buildImportPreview(
      [q({ id: "a", number: "Q-SAME" }), q({ id: "b", number: "Q-SAME" })],
      [],
      "agent",
    );
    expect(r.rows[0].state).toBe("importable");
    expect(r.rows[1].state).toBe("duplicate");
  });

  it("文件带合法 kind → 尊重文件,压过当前库", () => {
    const r = buildImportPreview([q({ id: "a", number: "Q-1", kind: "skill" })], [], "agent");
    expect(r.rows[0].question.kind).toBe("skill");
  });
});

describe("assignFreshIds", () => {
  it("换新 id,number 及其它字段不变", () => {
    const [res] = assignFreshIds([q({ id: "q_orig", number: "Q-1" })]);
    expect(res.id).not.toBe("q_orig");
    expect(res.id).toMatch(/^q/);
    expect(res.number).toBe("Q-1");
    expect(res.title).toBe("t");
    expect(res.prompt).toBe("p");
  });

  it("多题:每题 id 互不相同、条数一致", () => {
    const out = assignFreshIds([
      q({ id: "a", number: "Q-1" }),
      q({ id: "b", number: "Q-2" }),
      q({ id: "c", number: "Q-3" }),
    ]);
    expect(out).toHaveLength(3);
    const ids = out.map((x) => x.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("不 mutate 入参", () => {
    const src = q({ id: "keep", number: "Q-1" });
    assignFreshIds([src]);
    expect(src.id).toBe("keep");
  });

  it("空数组 → []", () => {
    expect(assignFreshIds([])).toEqual([]);
  });
});

describe("questionContentSig", () => {
  it("空白/大小写归一:首尾、连续空白、大小写不影响指纹", () => {
    expect(questionContentSig({ title: " Foo ", prompt: "a   b" })).toBe(
      questionContentSig({ title: "foo", prompt: "a b" }),
    );
  });

  it("title/prompt/subPrompts 任一不同 → 指纹不同", () => {
    const base = { title: "T", prompt: "P", subPrompts: ["s1"] };
    expect(questionContentSig(base)).not.toBe(
      questionContentSig({ ...base, prompt: "P2" }),
    );
    expect(questionContentSig(base)).not.toBe(
      questionContentSig({ ...base, subPrompts: ["s1", "s2"] }),
    );
  });

  it("subPrompts 缺省与空数组等价", () => {
    expect(questionContentSig({ title: "T", prompt: "P" })).toBe(
      questionContentSig({ title: "T", prompt: "P", subPrompts: [] }),
    );
  });
});

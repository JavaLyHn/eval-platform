import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetPromptStoreForTest,
  compilePrompt,
  deletePromptVersion,
  getPromptOverridesSnapshot,
  mergePromptOverridesFromServer,
  subscribePrompts,
  findMissingVars,
  findUnknownVars,
  getActiveTemplate,
  getEffectivePromptVersion,
  getPromptDefaultMeta,
  getPromptView,
  listPrompts,
  PROMPT_DEFS,
  renderTemplate,
  savePromptMeta,
  savePromptVersion,
  saveVarCustomization,
  setActivePromptVersion,
} from "./prompt-registry";

beforeEach(() => __resetPromptStoreForTest());

describe("renderTemplate", () => {
  it("替换 {{var}},未知占位符保留", () => {
    expect(renderTemplate("a {{x}} b {{y}}", { x: "1" })).toBe("a 1 b {{y}}");
  });
  it("空变量产生的连续空行压成一个空行,去尾部换行", () => {
    expect(renderTemplate("a\n{{x}}\n\n\nb\n", { x: "" })).toBe("a\n\nb");
  });
});

describe("变量校验", () => {
  it("findUnknownVars / findMissingVars", () => {
    expect(findUnknownVars("{{a}} {{bad}}", ["a"])).toEqual(["bad"]);
    expect(findMissingVars("{{a}}", ["a", "b"])).toEqual(["b"]);
  });
});

describe("元信息覆盖(savePromptMeta)", () => {
  const KEY = PROMPT_DEFS[0].key;

  it("覆盖名称 / 描述 / 调用点 → getPromptView 的 def 反映新值", () => {
    savePromptMeta(KEY, { name: "我的名字", description: "我的描述", usage: "我的调用点" });
    const def = getPromptView(KEY)!.def;
    expect(def.name).toBe("我的名字");
    expect(def.description).toBe("我的描述");
    expect(def.usage).toBe("我的调用点");
    // key(主键)不受影响
    expect(def.key).toBe(KEY);
  });

  it("留空 / 与默认相同 → 清掉覆盖,恢复内置默认", () => {
    const dflt = getPromptDefaultMeta(KEY);
    savePromptMeta(KEY, { name: "改了" });
    expect(getPromptView(KEY)!.def.name).toBe("改了");
    // 传回默认值 → 清覆盖
    savePromptMeta(KEY, { name: dflt.name, description: "", usage: "" });
    expect(getPromptView(KEY)!.def.name).toBe(dflt.name);
    expect(getPromptView(KEY)!.def.description).toBe(dflt.description);
  });

  it("元信息覆盖随快照上行、并能从服务端合并回来(本地优先)", () => {
    savePromptMeta(KEY, { name: "上行的名字" });
    const snap = getPromptOverridesSnapshot();
    expect((snap[KEY] as { nameOverride?: string }).nameOverride).toBe("上行的名字");
    // 模拟换设备:清空本地,从服务端合并 → 采用服务端覆盖
    __resetPromptStoreForTest();
    mergePromptOverridesFromServer({ [KEY]: { nameOverride: "服务端的名字" } });
    expect(getPromptView(KEY)!.def.name).toBe("服务端的名字");
  });
});

describe("版本管理(不可变版本 + 生效指针)", () => {
  const KEY = PROMPT_DEFS[0].key;

  it("初始:只有 v1 内置默认且生效", () => {
    const v = getPromptView(KEY)!;
    expect(v.versions.map((x) => x.version)).toEqual([1]);
    expect(v.activeVersion).toBe(1);
    expect(v.isCustomActive).toBe(false);
  });

  it("保存新版本 → 追加 v2 并自动生效;再存 → v3", () => {
    expect(savePromptVersion(KEY, "自定义 {{intro}}", "试验")).toBe(2);
    expect(savePromptVersion(KEY, "自定义2 {{intro}}")).toBe(3);
    const v = getPromptView(KEY)!;
    expect(v.versions.map((x) => x.version)).toEqual([1, 2, 3]);
    expect(v.activeVersion).toBe(3);
    expect(getActiveTemplate(KEY)).toBe("自定义2 {{intro}}");
  });

  it("回滚 = 指针移动(版本数据不删);恢复默认 = 指回 v1", () => {
    savePromptVersion(KEY, "v2 {{intro}}");
    savePromptVersion(KEY, "v3 {{intro}}");
    setActivePromptVersion(KEY, 2);
    expect(getActiveTemplate(KEY)).toBe("v2 {{intro}}");
    setActivePromptVersion(KEY, 1);
    const v = getPromptView(KEY)!;
    expect(v.activeVersion).toBe(1);
    expect(v.versions).toHaveLength(3); // v2/v3 仍在
  });

  it("指向不存在的版本被忽略", () => {
    setActivePromptVersion(KEY, 99);
    expect(getPromptView(KEY)!.activeVersion).toBe(1);
  });
});

describe("deletePromptVersion(删自定义版本;内置默认 v1 坚决不可删)", () => {
  // 用只有内置 v1 的 prompt(自定义版本从 2 起)。llm-judge 现带内置 v2(判分纳入文件),
  // 自定义会从 3 起、打乱这里的硬编码版本号,故改用 adaptive-followup。
  const KEY = "adaptive-followup";

  it("删自定义版本 → 从列表移除;删的不是生效版本则指针不动", () => {
    savePromptVersion(KEY, "v2 {{title}}");
    savePromptVersion(KEY, "v3 {{title}}"); // active = 3
    const next = deletePromptVersion(KEY, 2);
    const v = getPromptView(KEY)!;
    expect(v.versions.map((x) => x.version)).toEqual([1, 3]);
    expect(next).toBe(3);
    expect(v.activeVersion).toBe(3);
  });

  it("删生效版本 → 指针落到剩余最新自定义版本", () => {
    savePromptVersion(KEY, "v2 {{title}}");
    savePromptVersion(KEY, "v3 {{title}}"); // active = 3
    expect(deletePromptVersion(KEY, 3)).toBe(2);
    expect(getPromptView(KEY)!.activeVersion).toBe(2);
  });

  it("删唯一自定义版本(且生效) → 回退 v1 内置默认", () => {
    savePromptVersion(KEY, "v2 {{title}}"); // active = 2
    expect(deletePromptVersion(KEY, 2)).toBe(1);
    const v = getPromptView(KEY)!;
    expect(v.versions.map((x) => x.version)).toEqual([1]);
    expect(v.activeVersion).toBe(1);
  });

  it("内置默认 v1 坚决不可删(传 1 直接忽略)", () => {
    savePromptVersion(KEY, "v2 {{title}}"); // active = 2
    expect(deletePromptVersion(KEY, 1)).toBe(2); // 指针不动
    expect(getPromptView(KEY)!.versions.some((x) => x.version === 1)).toBe(true);
  });

  it("删不存在的版本 → 无副作用", () => {
    savePromptVersion(KEY, "v2 {{title}}");
    expect(deletePromptVersion(KEY, 99)).toBe(2);
    expect(getPromptView(KEY)!.versions.map((x) => x.version)).toEqual([1, 2]);
  });

  it("删除后服务端副本仍带该版本 → 合并(刷新)不复活(墓碑生效)", () => {
    savePromptVersion(KEY, "v2 {{title}}");
    savePromptVersion(KEY, "v3 {{title}}"); // active = 3
    deletePromptVersion(KEY, 2); // 删 v2 → 墓碑 [2]
    // 模拟刷新 hydration:服务端 / 旧 settings 副本里 v2 还在,并集本会加回来
    mergePromptOverridesFromServer({
      [KEY]: {
        activeVersion: 3,
        versions: [
          { version: 2, content: "服务端残留 v2(应被墓碑挡住)", createdAt: "t" },
          { version: 3, content: "v3 {{title}}", createdAt: "t" },
        ],
      },
    });
    expect(getPromptView(KEY)!.versions.map((x) => x.version)).toEqual([1, 3]);
  });

  it("服务端带 deletedVersions 墓碑 → 本地存在的该版本被清掉 + 指针回退(他端删除同步)", () => {
    savePromptVersion(KEY, "v2 {{title}}"); // local 有 v2,active = 2
    mergePromptOverridesFromServer({
      [KEY]: { activeVersion: 1, versions: [], deletedVersions: [2] },
    });
    const v = getPromptView(KEY)!;
    expect(v.versions.map((x) => x.version)).toEqual([1]);
    expect(v.activeVersion).toBe(1);
  });
});

describe("内置额外版本(builtinVersions:import-normalize v1/v2/v3)", () => {
  const KEY = "ai-question-import-normalize";
  const V2_MARKER = "一轮 = 一条用户消息 = 一个 content";
  const V3_MARKER = "缺附件时自拟";

  it("列出 v1 + v2 + v3,默认生效 = 最高内置版本 v3(且不算「自定义生效」)", () => {
    const v = getPromptView(KEY)!;
    expect(v.versions.map((x) => x.version)).toEqual([1, 2, 3]);
    expect(v.activeVersion).toBe(3);
    expect(v.isCustomActive).toBe(false); // v3 也是内置版本
  });

  it("v1 旧 / v2 多轮拆分 / v3 缺附件自拟;生效模板 = v3", () => {
    const v = getPromptView(KEY)!;
    const v1 = v.versions.find((x) => x.version === 1)!;
    const v2 = v.versions.find((x) => x.version === 2)!;
    const v3 = v.versions.find((x) => x.version === 3)!;
    expect(v2.content).toContain(V2_MARKER);
    expect(v1.content).not.toContain(V2_MARKER);
    // v3 = v2 + 附件规则:含附件规则、也含 v2 的多轮标记,且**确实 ≠ v2**(.replace 防裂:
    // 若锚点失配、v3 未变则此处会红,与 llm-judge v2 同款守护)。
    expect(v3.content).toContain(V3_MARKER);
    expect(v3.content).toContain("attachments");
    // 触发面已放宽:除「读/分析某份材料」外,也认「声称内容已给却没真给」(内容如下 / 邮件给你了)。
    expect(v3.content).toContain("内容如下");
    expect(v3.content).toContain(V2_MARKER);
    expect(v2.content).not.toContain(V3_MARKER);
    expect(v3.content).not.toBe(v2.content);
    expect(getActiveTemplate(KEY)).toBe(v3.content);
    expect(getEffectivePromptVersion(KEY)).toBe(3);
  });

  it("可回滚到 v1、再前滚回 v3", () => {
    setActivePromptVersion(KEY, 1);
    expect(getPromptView(KEY)!.activeVersion).toBe(1);
    expect(getPromptView(KEY)!.isCustomActive).toBe(false);
    setActivePromptVersion(KEY, 3);
    expect(getPromptView(KEY)!.activeVersion).toBe(3);
  });

  it("内置 v3/v2/v1 一样坚决不可删", () => {
    expect(deletePromptVersion(KEY, 3)).toBe(3); // 忽略,指针不动
    expect(getPromptView(KEY)!.versions.map((x) => x.version)).toEqual([1, 2, 3]);
    expect(deletePromptVersion(KEY, 1)).toBe(3);
    expect(getPromptView(KEY)!.versions.some((x) => x.version === 1)).toBe(true);
  });

  it("存自定义新版本 → 编号跳过内置 v3,得 v4 并生效", () => {
    expect(
      savePromptVersion(KEY, "自定义 {{rawBlock}} {{employeeBlock}} {{schema}}"),
    ).toBe(4);
    const v = getPromptView(KEY)!;
    expect(v.versions.map((x) => x.version)).toEqual([1, 2, 3, 4]);
    expect(v.activeVersion).toBe(4);
    expect(v.isCustomActive).toBe(true);
  });
});

describe("compilePrompt(带 fallback)", () => {
  const KEY = "skillopt-case-gen";
  const vars = {
    skillName: "S",
    skillBody: "B",
    employeeName: "Aria",
    employeeTitle: "T",
    servesAudience: "A",
    coreTasks: "C",
    outOfScope: "O",
    intentLabels: "L",
  };

  it("默认走内置模板,变量注入", () => {
    const out = compilePrompt(KEY, vars);
    expect(out).toContain("技能名:S");
    expect(out).toContain("员工:Aria —— T");
    expect(out).not.toContain("{{");
  });

  it("自定义版本生效后按自定义渲染", () => {
    savePromptVersion(KEY, "只测 {{skillName}} 的精简版");
    expect(compilePrompt(KEY, vars)).toBe("只测 S 的精简版");
  });

  it("自定义模板把已知变量名拼错(渲染后残留占位符)→ 回退内置默认", () => {
    savePromptVersion(KEY, "坏模板 {{skillNme}} 但又用了 {{skillName}}");
    const out = compilePrompt(KEY, { ...vars });
    // 不包含坏模板特征,回退到内置
    expect(out).not.toContain("坏模板");
    expect(out).toContain("技能名:S");
  });

  it("未知 key 抛错", () => {
    expect(() => compilePrompt("nope", {})).toThrow();
  });
});

describe("变量定制(说明覆盖 + 自定义固定值变量)", () => {
  const KEY = "skillopt-case-gen";
  const vars = {
    skillName: "S",
    skillBody: "B",
    employeeName: "Aria",
    employeeTitle: "T",
    servesAudience: "A",
    coreTasks: "C",
    outOfScope: "O",
    intentLabels: "L",
  };

  it("内置变量说明可覆盖;与默认相同/空白自动剔除", () => {
    saveVarCustomization(KEY, {
      descOverrides: {
        skillName: "我的新说明",
        skillBody: "数据块:SKILL.md 正文(黑盒)", // 与默认一致 → 剔除
        unknown: "不存在的内置 → 忽略",
      },
      customVars: [],
    });
    const v = getPromptView(KEY)!;
    expect(v.builtinVars.find((x) => x.name === "skillName")!.description).toBe(
      "我的新说明",
    );
    expect(v.builtinVars.find((x) => x.name === "skillBody")!.description).toBe(
      "数据块:SKILL.md 正文(黑盒)",
    );
  });

  it("自定义变量编译时注入;模板可引用而不触发回退", () => {
    saveVarCustomization(KEY, {
      descOverrides: {},
      customVars: [{ name: "tone", description: "统一语气", value: "务必礼貌" }],
    });
    savePromptVersion(KEY, "要求:{{tone}};技能 {{skillName}}");
    expect(compilePrompt(KEY, vars)).toBe("要求:务必礼貌;技能 S");
  });

  it("非法名 / 与内置重名 / 重复名在保存时被剔除", () => {
    saveVarCustomization(KEY, {
      descOverrides: {},
      customVars: [
        { name: "好 名", description: "", value: "x" }, // 非法
        { name: "skillName", description: "", value: "x" }, // 与内置重名
        { name: "ok", description: "", value: "1" },
        { name: "ok", description: "", value: "2" }, // 重复,保留第一个
      ],
    });
    const v = getPromptView(KEY)!;
    expect(v.customVars).toEqual([{ name: "ok", description: "", value: "1" }]);
  });

  it("运行时变量与自定义变量同名时,运行时优先", () => {
    saveVarCustomization(KEY, {
      descOverrides: {},
      customVars: [{ name: "extra", description: "", value: "默认值" }],
    });
    savePromptVersion(KEY, "{{extra}}");
    expect(compilePrompt(KEY, { ...vars, extra: "运行时值" })).toBe("运行时值");
  });
});

describe("落库同步(快照 + 服务端合并)", () => {
  // 用只有内置 v1 的 prompt:自定义 / 服务端版本从 2 起。llm-judge 现带内置 v2
  // (判分纳入文件),会与这里把 v2 当「自定义/服务端版本」的断言撞号,故改用 ai-question-gen。
  const KEY = "ai-question-gen";

  it("快照引用稳定:无变更同引用,变更后换新对象", () => {
    const a = getPromptOverridesSnapshot();
    expect(getPromptOverridesSnapshot()).toBe(a);
    savePromptVersion(KEY, "x {{title}}");
    const b = getPromptOverridesSnapshot();
    expect(b).not.toBe(a);
    expect(b[KEY].versions).toHaveLength(1);
  });

  it("订阅:保存 / 移指针都会触发", () => {
    let fired = 0;
    const off = subscribePrompts(() => fired++);
    savePromptVersion(KEY, "x {{title}}");
    setActivePromptVersion(KEY, 1);
    off();
    setActivePromptVersion(KEY, 2);
    expect(fired).toBe(2);
  });

  it("服务端合并:本地没有的版本号补进来,同号/指针本地优先", () => {
    savePromptVersion(KEY, "本地 v2 {{title}}"); // local v2, active=2
    mergePromptOverridesFromServer({
      [KEY]: {
        activeVersion: 3,
        versions: [
          { version: 2, content: "服务端同号 v2(应被忽略)", createdAt: "t" },
          { version: 3, content: "服务端 v3 {{title}}", createdAt: "t" },
        ],
      },
      "unknown-key": { activeVersion: 2, versions: [] },
    });
    const v = getPromptView(KEY)!;
    expect(v.versions.map((x) => x.version)).toEqual([1, 2, 3]);
    expect(v.versions.find((x) => x.version === 2)!.content).toBe(
      "本地 v2 {{title}}",
    );
    // 指针本地优先,仍指 v2
    expect(v.activeVersion).toBe(2);
  });

  it("本地无记录时整体采用服务端(含指针);坏数据被过滤", () => {
    mergePromptOverridesFromServer({
      [KEY]: {
        activeVersion: 2,
        versions: [
          { version: 2, content: "服务端 v2 {{title}}", createdAt: "t" },
          { version: 1, content: "伪造 v1(应剔除)", createdAt: "t" },
          { content: "缺 version(应剔除)" },
        ],
      },
    });
    const v = getPromptView(KEY)!;
    expect(v.versions.map((x) => x.version)).toEqual([1, 2]);
    expect(v.activeVersion).toBe(2);
    expect(getActiveTemplate(KEY)).toBe("服务端 v2 {{title}}");
  });
});

describe("llm-judge 内置 v2(判分纳入 Agent 产出文件)", () => {
  const KEY = "llm-judge";
  it("默认生效 = v2;v2 模板注入 {{filesBlock}},v1 不含;评测戳 v2", () => {
    expect(getEffectivePromptVersion(KEY)).toBe(2);
    const view = getPromptView(KEY)!;
    expect(view.activeVersion).toBe(2);
    expect(view.builtinVersionNumbers).toEqual([1, 2]);
    const v1 = view.versions.find((v) => v.version === 1)!;
    const v2 = view.versions.find((v) => v.version === 2)!;
    expect(v1.content).not.toContain("{{filesBlock}}");
    expect(v2.content).toContain("{{filesBlock}}");
    // 生效模板(v2)确实带 filesBlock —— 保证 .replace 真的插进去了、不是回退成 v1。
    expect(getActiveTemplate(KEY)).toContain("{{filesBlock}}");
    // v2 只比 v1 多了 filesBlock(其余逐字一致):把 v1 注入 filesBlock 后应等于 v2。
    expect(
      v1.content.replace("{{answerBlock}}\n\n{{toolBlock}}", "{{answerBlock}}{{filesBlock}}\n\n{{toolBlock}}"),
    ).toBe(v2.content);
  });
});

describe("目录完整性", () => {
  it("内置 prompt 注册齐全(含拆链 draft/criteria),模板里声明的变量与文档一致", () => {
    const keys = listPrompts().map((p) => p.def.key);
    expect(keys).toEqual([
      "ai-question-gen",
      "ai-question-gen-draft",
      "ai-question-gen-criteria",
      "llm-judge",
      "skillopt-case-gen",
      "adaptive-followup",
      "ai-question-import-normalize",
    ]);
    for (const def of PROMPT_DEFS) {
      const known = def.variables.map((v) => v.name);
      const builtinTexts = [
        def.defaultTemplate,
        ...(def.builtinVersions ?? []).map((v) => v.content),
      ];
      // 每个内置版本(v1 + builtinVersions)只用已声明变量、示例可完整渲染。
      // findUnknownVars 逐版本必须为空:compilePrompt 靠它判「模板改坏」,任一版本出现
      // 未声明占位符都会触发回退。
      for (const text of builtinTexts) {
        expect(findUnknownVars(text, known)).toEqual([]);
        expect(findUnknownVars(renderTemplate(text, def.sampleVars), [])).toEqual([]);
      }
      // 文档化的变量都至少被**某个**内置版本用到(按并集判):新版本可引入新变量
      // (如 llm-judge v2 的 filesBlock),老版本 defaultTemplate 不含它是正常的。
      expect(findMissingVars(builtinTexts.join("\n"), known)).toEqual([]);
    }
  });
});

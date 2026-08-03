import { describe, it, expect } from "vitest";
import {
  resolveInitialForm,
  seedDefaultsFor,
  draftKeyFor,
  setDraft,
  getDraft,
  clearDraft,
} from "./profile-form-draft";
import type { AgentProfile, AgentProvider, FieldSpec } from "@/agents/types";

const provider = (id: string, schema: FieldSpec[] = []): AgentProvider => ({
  id,
  label: id,
  description: id,
  kind: "llm",
  configSchema: schema,
  createClient: () => ({}) as never,
});

const savedProfile = (): AgentProfile => ({
  id: "p1",
  name: "已保存的名字",
  providerId: "anthropic",
  config: { baseUrl: "https://api.anthropic.com", apiKey: "saved-key" },
  createdAt: "t",
});

describe("resolveInitialForm", () => {
  it("草稿优先于已保存 profile —— 填了没保存、关掉再打开，输入仍在", () => {
    const draft = {
      name: "正在输入的名字",
      providerId: "anthropic",
      config: { baseUrl: "https://typed", apiKey: "typed-key" },
    };
    const r = resolveInitialForm({
      draft,
      profile: savedProfile(),
      providers: [provider("anthropic")],
    });
    expect(r).toEqual(draft);
    // config 必须是拷贝,不能与草稿同引用(避免后续 setState 互相污染)
    expect(r.config).not.toBe(draft.config);
  });

  it("无草稿时回填已保存 profile 的 config(编辑场景)", () => {
    const r = resolveInitialForm({
      draft: undefined,
      profile: savedProfile(),
      providers: [provider("anthropic")],
    });
    expect(r.name).toBe("已保存的名字");
    expect(r.providerId).toBe("anthropic");
    expect(r.config).toEqual({
      baseUrl: "https://api.anthropic.com",
      apiKey: "saved-key",
    });
  });

  it("无草稿、无 profile 时按首个 provider 的默认值起表(新增场景)", () => {
    const prov = provider("platform", [
      { key: "instanceId", label: "被测实例 ID", type: "string", required: true },
      { key: "modelLabel", label: "显示名", type: "string", default: "platform" },
    ]);
    const r = resolveInitialForm({
      draft: undefined,
      profile: undefined,
      providers: [prov],
    });
    expect(r).toEqual({
      name: "",
      providerId: "platform",
      config: { modelLabel: "platform" },
    });
  });
});

describe("seedDefaultsFor", () => {
  it("只取带 default 的字段,缺省字段不进 config", () => {
    const prov = provider("x", [
      { key: "a", label: "a", type: "string" },
      { key: "b", label: "b", type: "string", default: "B" },
      { key: "flag", label: "flag", type: "boolean", default: false },
    ]);
    expect(seedDefaultsFor(prov)).toEqual({ b: "B", flag: false });
  });

  it("provider 为空返回空对象", () => {
    expect(seedDefaultsFor(undefined)).toEqual({});
  });
});

describe("draftKeyFor + 草稿存取", () => {
  it("编辑按 profile.id 作 key、新增按 kind 作 key", () => {
    expect(draftKeyFor(savedProfile(), "agent")).toBe("edit:p1");
    expect(draftKeyFor(undefined, "llm")).toBe("add:llm");
  });

  it("setDraft / getDraft / clearDraft 往返", () => {
    const key = "add:llm";
    expect(getDraft(key)).toBeUndefined();
    const d = { name: "n", providerId: "anthropic", config: { apiKey: "k" } };
    setDraft(key, d);
    expect(getDraft(key)).toEqual(d);
    clearDraft(key);
    expect(getDraft(key)).toBeUndefined();
  });
});

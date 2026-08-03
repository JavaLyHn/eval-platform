/**
 * Profile 表单的「草稿」机制 —— 让用户填到一半的内容在关闭 / 重新打开弹窗后
 * 依旧保留,而不是只有点了「保存」才不丢。
 *
 * 背景:此前表单只有显式「保存」才会落到 profile;若配置填错、连接测不通,
 * 用户为了去核对凭据等中途关掉弹窗(没保存),再点开就一片空白。现在每次输入
 * 都写进内存草稿,打开时草稿优先回填,保存成功后清掉草稿。
 *
 * 故意**用内存 Map、不进 localStorage** —— 否则填了一半的 API Key 会长期残留在
 * 磁盘上。草稿只需在「本次会话内关掉再打开」存活,内存足够。
 */

import type { AgentProfile, AgentProvider } from "@/agents/types";

export interface ProfileFormDraft {
  name: string;
  providerId: string;
  config: Record<string, unknown>;
}

/** 取一个 provider 配置里所有「带 default 的字段」作为初始 config。 */
export function seedDefaultsFor(
  provider: AgentProvider | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (provider) {
    for (const f of provider.configSchema) {
      if (f.default !== undefined) out[f.key] = f.default;
    }
  }
  return out;
}

/**
 * 决定弹窗打开时表单该回填什么。
 * 优先级:未保存的草稿(关掉再打开仍在) > 已保存 profile 的 config(编辑) >
 * 首个 provider 的默认值(全新新增)。
 */
export function resolveInitialForm(args: {
  draft: ProfileFormDraft | undefined;
  profile: AgentProfile | undefined;
  providers: AgentProvider[];
}): ProfileFormDraft {
  const { draft, profile, providers } = args;
  if (draft) {
    return {
      name: draft.name,
      providerId: draft.providerId,
      config: { ...draft.config },
    };
  }
  if (profile) {
    return {
      name: profile.name,
      providerId: profile.providerId,
      config: { ...profile.config },
    };
  }
  const first = providers[0];
  return {
    name: "",
    providerId: first?.id ?? "",
    config: seedDefaultsFor(first),
  };
}

/** 稳定的草稿 key:编辑按 profile.id、新增按 kind 区分,互不串台。 */
export function draftKeyFor(
  profile: AgentProfile | undefined,
  kind: string,
): string {
  return profile ? `edit:${profile.id}` : `add:${kind}`;
}

/* ── 进程内草稿仓(见文件头:不落 localStorage) ──────────────────────────── */
const drafts = new Map<string, ProfileFormDraft>();

export function getDraft(key: string): ProfileFormDraft | undefined {
  return drafts.get(key);
}

export function setDraft(key: string, draft: ProfileFormDraft): void {
  drafts.set(key, draft);
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}

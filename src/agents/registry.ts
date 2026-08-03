import type { AgentProvider, ProviderKind } from "./types";

const registry = new Map<string, AgentProvider>();

export function registerProvider(p: AgentProvider): void {
  if (registry.has(p.id)) {
    // Allow re-registration (e.g. HMR) without warning.
  }
  registry.set(p.id, p);
}

export function getProvider(id: string): AgentProvider | undefined {
  return registry.get(id);
}

/**
 * 不在选择器里展示的 provider id(当前为空)。平台全面转 platform;
 * 如需临时隐藏某 provider,把它的 id 加进本 set 即可(仍保留注册,旧 profile 照常可用)。
 */
const HIDDEN_PROVIDER_IDS = new Set<string>([]);

export function listProviders(opts?: {
  kind?: ProviderKind;
  includeHidden?: boolean;
}): AgentProvider[] {
  let arr = Array.from(registry.values());
  if (!opts?.includeHidden)
    arr = arr.filter((p) => !HIDDEN_PROVIDER_IDS.has(p.id));
  if (opts?.kind) arr = arr.filter((p) => p.kind === opts.kind);
  return arr.sort((a, b) => {
    const ap = a.priority ?? 50;
    const bp = b.priority ?? 50;
    if (ap !== bp) return ap - bp;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Derive the kind of a profile by looking up its provider. Returns `null` if
 * the provider isn't registered (legacy / removed provider) — callers should
 * treat that as "unknown" and usually filter out.
 */
export function getProfileKind(providerId: string): ProviderKind | null {
  return registry.get(providerId)?.kind ?? null;
}

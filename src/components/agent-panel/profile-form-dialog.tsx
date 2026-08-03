import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQAStore, listProviders } from "@/hooks/use-qa-store";
import { createProfile } from "@/agents/profiles";
import { cn } from "@/lib/utils";
import {
  resolveInitialForm,
  seedDefaultsFor,
  draftKeyFor,
  getDraft,
  setDraft,
  clearDraft,
} from "./profile-form-draft";
import type { AgentProfile, FieldSpec, ProviderKind } from "@/agents/types";

interface ProfileFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile?: AgentProfile;
  /**
   * Constrain the dialog to a single profile kind. When opening as "add", this
   * also filters the provider dropdown + preset chips. When editing, this is
   * derived from the existing profile's provider and the prop is ignored.
   */
  kind?: ProviderKind;
}

export function ProfileFormDialog({
  open,
  onOpenChange,
  profile,
  kind = "agent",
}: ProfileFormDialogProps) {
  const {
    addProfile,
    updateProfile,
    setActiveProfile,
    activeProfileId,
    requestVerifyWithNotice,
  } = useQAStore();
  // Stabilize the providers array — listProviders() returns a NEW sorted array
  // on every call, which would otherwise re-fire the field-population effect
  // on every render and overwrite the user's typing.
  // When editing an existing profile we still pull the full list so the
  // dropdown can render whatever provider it was created with — even if that
  // doesn't match the current `kind` filter.
  const providers = useMemo(
    () => (profile ? listProviders() : listProviders({ kind })),
    [profile, kind],
  );
  const headingNoun = kind === "llm" ? "LLM 模型" : "Agent";
  const isEdit = !!profile;

  const [name, setName] = useState("");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [config, setConfig] = useState<Record<string, unknown>>({});

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId],
  );

  // 草稿 key:编辑按 profile.id、新增按 kind 区分。
  const draftKey = useMemo(() => draftKeyFor(profile, kind), [profile, kind]);

  // Populate fields when the dialog opens or the target profile changes.
  // 回填优先级:未保存草稿 > 已保存 profile > provider 默认值(见 resolveInitialForm)。
  // 这是初始加载的**唯一**来源——没有别的 effect 碰 `config`,所以打开瞬间不会被
  // 「seed 默认值」之类的 effect 在同一次提交里覆盖掉。
  useEffect(() => {
    if (!open) return;
    const init = resolveInitialForm({
      draft: getDraft(draftKey),
      profile,
      providers,
    });
    setName(init.name);
    setProviderId(init.providerId);
    setConfig(init.config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile, draftKey]);

  // 每次输入都写进内存草稿 —— 这样「填了一半关掉、再点开」内容仍在,不必先保存。
  // 仅在弹窗打开时写;关闭(open=false)时直接 return,**不清草稿**,留着下次回填。
  // 保存成功时才由 handleSubmit 显式 clearDraft。
  useEffect(() => {
    if (!open) return;
    setDraft(draftKey, { name, providerId, config });
  }, [open, draftKey, name, providerId, config]);

  /** User picked a different provider in the dropdown — seed defaults for the
   *  new provider. If they pick back to the loaded profile's provider, restore
   *  the original saved config so editing doesn't lose data. */
  const handleProviderChange = (nextId: string) => {
    setProviderId(nextId);
    if (profile && nextId === profile.providerId) {
      setConfig({ ...profile.config });
      return;
    }
    setConfig(seedDefaultsFor(providers.find((p) => p.id === nextId)));
  };

  if (!provider) return null;

  /**
   * Trim leading/trailing whitespace on every string-shaped config value
   * before save. Users routinely paste API keys with a stray newline or
   * space — Anthropic 401s, OpenAI 401s, Platform rejects. Silent trim is
   * the right default; if anyone actually needs leading whitespace in some
   * config, they can ask later.
   */
  const trimmedConfig = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      out[k] = typeof v === "string" ? v.trim() : v;
    }
    return out;
  };

  const handleSubmit = () => {
    const cleanName = name.trim();
    const cleanConfig = trimmedConfig();
    let targetId: string;
    if (isEdit && profile) {
      updateProfile(profile.id, {
        name: cleanName,
        providerId,
        config: cleanConfig,
        // 配置可能改了 → 重置为未验证,等自动连接测试重新验证通过才继续显示该员工。
        verified: false,
      });
      targetId = profile.id;
    } else {
      const created = createProfile({
        name: cleanName,
        providerId,
        config: cleanConfig,
      });
      addProfile(created);
      // Auto-activate first profile.
      if (!activeProfileId) setActiveProfile(created.id);
      targetId = created.id;
    }
    // 添加/保存后自动做一次连接测试(由 store 自愈验证 effect 执行,避开新建的 stale-closure
    // 竞态),并弹「已连接/连接失败」通知:通过 → 对应标准员工随即显示;失败 → 用户据此去编辑重试。
    requestVerifyWithNotice(targetId);
    // 保存成功 —— 内容已落到 profile,清掉草稿:下次打开回填的是已保存值,
    // 而新增表单也回到一张干净的空表。
    clearDraft(draftKey);
    onOpenChange(false);
  };

  // Validate required fields.
  const missing = provider.configSchema
    .filter((f) => f.required && !String(config[f.key] ?? "").trim())
    .map((f) => f.label);
  const canSubmit = name.trim() && missing.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {isEdit ? `编辑${headingNoun}` : `添加${headingNoun}`}
          </DialogTitle>
          <DialogDescription>
            {kind === "llm"
              ? "纯 LLM API 端点（GPT / DeepSeek / Claude / 通义 / Moonshot 等）。用作裁判 / AI 出题 / 反思。"
              : "完整 agent 后端（Platform 员工实例)。用作被测员工。"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          <Field label="名称" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="给这个连接起一个好认的名字"
              autoComplete="off"
              name="cfg-profile-name"
            />
          </Field>

          <Field label="Provider" required>
            <Select value={providerId} onValueChange={handleProviderChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {provider.configSchema.map((f) => (
            <DynamicField
              key={f.key}
              spec={f}
              value={config[f.key]}
              onChange={(v) => setConfig({ ...config, [f.key]: v })}
            />
          ))}

          {missing.length > 0 && (
            <p className="text-[11px] text-warning">
              请填写必填项：{missing.join("、")}
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isEdit ? "保存" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      <span>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
        {hint && (
          <span className="ml-1.5 font-normal text-muted-foreground/70">
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function DynamicField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [showSecret, setShowSecret] = useState(false);

  switch (spec.type) {
    case "select":
      return (
        <Field label={spec.label} required={spec.required} hint={spec.help}>
          <Select
            value={String(value ?? spec.default ?? "")}
            onValueChange={onChange}
          >
            <SelectTrigger>
              <SelectValue placeholder={spec.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {spec.options?.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );
    case "boolean":
      return (
        <Field label={spec.label} hint={spec.help}>
          <Select
            value={value ? "true" : "false"}
            onValueChange={(v) => onChange(v === "true")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">是</SelectItem>
              <SelectItem value="false">否</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      );
    case "secret":
      return (
        <Field label={spec.label} required={spec.required} hint={spec.help}>
          <div className="relative">
            <Input
              type={showSecret ? "text" : "password"}
              value={String(value ?? "")}
              onChange={(e) => onChange(e.target.value)}
              placeholder={spec.placeholder}
              className="pr-8 font-mono"
              autoComplete="new-password"
              name={`cfg-${spec.key}`}
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              {showSecret ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </Field>
      );
    case "number":
      return (
        <Field label={spec.label} required={spec.required} hint={spec.help}>
          <Input
            type="number"
            value={value == null ? "" : String(value)}
            onChange={(e) =>
              onChange(e.target.value ? Number(e.target.value) : "")
            }
            placeholder={spec.placeholder}
          />
        </Field>
      );
    case "url":
    case "string":
    default:
      return (
        <Field label={spec.label} required={spec.required} hint={spec.help}>
          <Input
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={spec.placeholder}
            className={cn(spec.type === "url" && "font-mono text-[12.5px]")}
            autoComplete="off"
            name={`cfg-${spec.key}`}
          />
        </Field>
      );
  }
}

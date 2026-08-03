import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  Check,
  KeyRound,
  LogOut,
  Trash2,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/hooks/use-auth";
import { useQAStore } from "@/hooks/use-qa-store";
import { api } from "@/lib/api";
import { validatePassword } from "@/lib/auth-validate";
import { rememberEmail } from "@/lib/auth-local";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@/types";

interface UserProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserProfileDialog({
  open,
  onOpenChange,
}: UserProfileDialogProps) {
  const { user, setUser, clearUser } = useQAStore();
  const { me, logout, refresh } = useAuth();

  const [draft, setDraft] = useState<UserProfile>(user);
  const fileRef = useRef<HTMLInputElement>(null);
  // 弹窗内所有输入框(姓名/职位/当前·新·确认密码)初始只读、聚焦时才解开 —— 断掉
  // 浏览器/密码管理器在加载时把存过的登录凭据 autofill 进来(职位框被误当用户名、
  // 当前密码框被塞入陌生账号密码)。autofill 只在加载时扫描,只读框不填;聚焦已过其时机。
  const [fieldsRO, setFieldsRO] = useState(true);

  // 密码:Google 建的无密码账户在此首次设密码,之后即可用邮箱 + 密码登录。
  const hasPassword = me?.hasPassword ?? false;
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  // 保存(姓名 / 头像同步到后端 PG)的状态。
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Reset draft when dialog opens.
  useEffect(() => {
    if (open) setDraft(user);
  }, [open, user]);

  // 每次打开都清空密码输入(避免泄漏上次输入 / 残留状态)。
  useEffect(() => {
    if (open) {
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
      setPwMsg(null);
      setSaveErr(null);
      setSaving(false);
    }
  }, [open]);

  const handleSetPassword = async () => {
    setPwMsg(null);
    const err = validatePassword(newPw);
    if (err) return setPwMsg({ ok: false, text: err });
    if (newPw !== confirmPw)
      return setPwMsg({ ok: false, text: "两次输入的新密码不一致" });
    if (hasPassword && !curPw)
      return setPwMsg({ ok: false, text: "请输入当前密码" });
    setPwLoading(true);
    try {
      await api.auth.setPassword(newPw, hasPassword ? curPw : undefined);
      await refresh(); // 刷新 me.hasPassword → 标题切到「修改密码」
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
      setPwMsg({
        ok: true,
        text: hasPassword ? "密码已更新" : "密码已设置,现在可以用邮箱 + 密码登录",
      });
    } catch (e) {
      setPwMsg({
        ok: false,
        text: e instanceof Error ? e.message : "设置失败,请重试",
      });
    } finally {
      setPwLoading(false);
    }
  };

  const handleSave = async () => {
    setSaveErr(null);
    // 本地优先:先存本地(与平台其余 localStorage-first 行为一致),再同步后端。
    setUser(draft);
    setSaving(true);
    try {
      // 姓名 / 头像同步到后端 PG → 跨设备一致。「角色 / 职位」是本地概念,不上行。
      // 头像仅在本地确有数据时才上传,避免无意中清掉服务端(如 Google)头像;
      // 头像「移除」暂仍是本地行为。
      await api.auth.updateProfile({
        name: draft.name?.trim() || undefined,
        ...(draft.avatarUrl ? { avatarUrl: draft.avatarUrl } : {}),
      });
      await refresh(); // 刷新 me(name / avatar)
      onOpenChange(false);
    } catch (e) {
      // 本地已保存,但 PG 没收到 —— 不静默,提示并留窗重试。
      setSaveErr(e instanceof Error ? e.message : "同步到服务器失败,请重试");
    } finally {
      setSaving(false);
    }
  };

  // 选本地图片 → canvas 缩放到 ≤256px → data URL 存进 avatarUrl(体积小,可入库/同步)。
  const handlePickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许再次选同一文件
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        setDraft((d) => ({ ...d, avatarUrl: dataUrl }));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const displayName = draft.name?.trim() || me?.name || me?.email?.split("@")[0] || "未命名";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[88vh] max-w-md flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3.5">
          <DialogTitle className="text-[15px]">个人信息</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* 资料头:头像(点击更换)+ 名字 + 登录邮箱 */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="更换头像"
              className="group relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Avatar user={draft} size={64} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="h-5 w-5 text-white" />
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePickAvatar}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-foreground">
                {displayName}
              </div>
              {me?.email && (
                <div className="truncate text-xs text-muted-foreground">
                  {me.email}
                </div>
              )}
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="text-[11.5px] font-medium text-accent hover:underline"
                >
                  更换头像
                </button>
                {draft.avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, avatarUrl: undefined })}
                    className="text-[11.5px] text-muted-foreground hover:text-destructive"
                  >
                    移除
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 资料字段 */}
          <div className="mt-5 grid gap-3.5">
            <Field label="姓名">
              <Input
                name="profile-display-name"
                autoComplete="off"
                readOnly={fieldsRO}
                onFocus={() => setFieldsRO(false)}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="你叫什么名字"
              />
            </Field>
          </div>

          {/* 密码区 */}
          <SectionLabel icon={KeyRound}>
            {hasPassword ? "修改密码" : "设置密码"}
          </SectionLabel>
          <p className="mb-3 text-[11.5px] leading-relaxed text-muted-foreground">
            {hasPassword
              ? "修改后用新密码 + 邮箱登录,Google 登录仍可用。"
              : "用 Google 登录创建的账号还没有密码;设置后即可用「邮箱 + 密码」登录(Google 登录仍可用)。"}
          </p>
          <div className="grid gap-2.5">
            {hasPassword && (
              <PasswordInput
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                placeholder="当前密码"
                autoComplete="current-password"
                readOnly={fieldsRO}
                onFocus={() => setFieldsRO(false)}
              />
            )}
            <PasswordInput
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="新密码(至少 8 位)"
              autoComplete="new-password"
              readOnly={fieldsRO}
              onFocus={() => setFieldsRO(false)}
            />
            <PasswordInput
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="确认新密码"
              autoComplete="new-password"
              readOnly={fieldsRO}
              onFocus={() => setFieldsRO(false)}
            />
            {pwMsg && (
              <p
                className={cn(
                  "flex items-center gap-1.5 text-[11.5px]",
                  pwMsg.ok ? "text-success" : "text-destructive",
                )}
              >
                {pwMsg.ok ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                {pwMsg.text}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={pwLoading}
              onClick={() => void handleSetPassword()}
            >
              {pwLoading ? "提交中…" : hasPassword ? "修改密码" : "设置密码"}
            </Button>
          </div>
        </div>

        {/* 保存同步失败提示(本地已存,仅后端未同步) */}
        {saveErr && (
          <p className="flex shrink-0 items-center gap-1.5 px-5 pt-2 text-[11.5px] text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">已保存到本地,但同步到服务器失败:{saveErr}</span>
          </p>
        )}

        {/* 底栏 */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // 切换账号:记住当前邮箱(便于回切)→ 登出并跳登录页,登录页会列出
                // 本机登录过的账号一键回填。Cookie 单会话,无法两账号同时在线,故走登出重登。
                if (me?.email) rememberEmail(me.email);
                void logout();
              }}
              className="gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
            >
              <Users className="h-3.5 w-3.5" />
              切换账号
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void logout()}
              className="gap-1.5 text-[12px] text-muted-foreground hover:text-destructive"
            >
              <LogOut className="h-3.5 w-3.5" />
              登出
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                clearUser();
                onOpenChange(false);
              }}
              className="gap-1.5 text-[12px] text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清除资料
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** 小节标题:图标 + 文案 + 一道横线,分隔资料区与密码区。 */
function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: typeof KeyRound;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 mt-6 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs font-semibold text-foreground">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Tiny circular avatar. Falls back to first character (or "?") when no
 * avatarUrl is provided. Reused by the dialog preview and the top-bar.
 */
export function Avatar({
  user,
  size = 28,
  className,
}: {
  user: Pick<UserProfile, "name" | "avatarUrl">;
  size?: number;
  className?: string;
}) {
  const initial = (user.name?.trim()?.[0] ?? "?").toUpperCase();
  const styles = {
    width: size,
    height: size,
    fontSize: Math.max(10, Math.floor(size * 0.42)),
  };

  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name || "user"}
        style={styles}
        className={
          "rounded-full border border-border object-cover " + (className ?? "")
        }
        // If the URL is broken, render the initial instead.
        onError={(e) => {
          const img = e.currentTarget;
          img.style.display = "none";
        }}
      />
    );
  }

  return (
    <span
      style={styles}
      className={
        "inline-flex items-center justify-center rounded-full bg-accent/15 font-semibold text-accent " +
        (className ?? "")
      }
    >
      {initial}
    </span>
  );
}

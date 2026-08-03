import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { clearAllPlatformData } from "@/lib/persistence";
import { AUTH_MARKER_KEY, clearLocalUserMarker } from "@/lib/auth-local";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl: string;
  /** false = Google 建的无密码账户(可在个人信息里设置密码后用账号密码登录)。 */
  hasPassword: boolean;
}

type Status = "loading" | "authed" | "anon";

interface AuthValue {
  status: Status;
  me: Me | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    try {
      const u = await api.auth.me();
      setMe(u);
      setStatus("authed");
    } catch {
      setMe(null);
      setStatus("anon");
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* 即使后端报错也照常清本地、转 anon */
    }
    clearAllPlatformData();
    clearLocalUserMarker();
    setMe(null);
    setStatus("anon");
    if (typeof window !== "undefined") window.location.assign("/login");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 跨标签页身份变更侦测:别的标签切换/退出账号会改写 qa-auth:lastUserId
  // (reconcileLocalUser / clearLocalUserMarker 都写它),该写入在**本标签**触发 storage 事件。
  // 因为鉴权是浏览器级共享 Cookie —— 别处切走账号后,本标签的内存数据 + me 都过期了,
  // 会出现「新账号身份 + 旧账号会话」的混态。此时整页刷新,重走 auth→reconcile→hydrate,
  // 回到「单一当前账号 + 对应数据」的一致状态(storage 事件只在其他标签触发,不会自刷)。
  useEffect(() => {
    const meId = me?.id ?? null;
    if (!meId) return; // 未登录(如停在 /login)不处理
    const onStorage = (e: StorageEvent) => {
      // 标记变成了别的身份(切号)或被清空(退出)→ 本标签已过期,刷新。
      if (e.key === AUTH_MARKER_KEY && e.newValue !== meId) {
        window.location.reload();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [me]);

  return (
    <AuthContext.Provider value={{ status, me, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return v;
}

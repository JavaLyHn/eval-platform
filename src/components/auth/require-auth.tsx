import { useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { reconcileLocalUser } from "@/lib/auth-local";

/** 登录守卫:未登录跳 /login;已登录则在挂载数据 store 前先按用户隔离本地数据。 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, me } = useAuth();
  const reconciledRef = useRef(false);

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }
  if (status === "anon" || !me) {
    return <Navigate to="/login" replace />;
  }

  // 已登录:在渲染 QAStoreProvider(其 useState 初始化会读 localStorage)之前,
  // 同步完成「换用户清本地」。reconcile 幂等 + ref 保证每次加载只跑一次。
  if (!reconciledRef.current) {
    reconcileLocalUser(me.id);
    reconciledRef.current = true;
  }
  return <>{children}</>;
}

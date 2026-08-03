/**
 * Top status banner — 只在「有问题」时出横幅:后端未连接 / 迁移失败 / 同步失败。
 *
 * 本地数据在启动时**静默自动迁移**到 postgres(idempotent PUT-by-id upsert),
 * 所以不再主动弹「一次性导入?」这类 info 提示;正常 / 同步完成时不打扰。
 * Phase 2(live sync):每次写操作排进 `outbox` 后台推送,这里只在堆积失败时提示。
 */

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, XCircle } from "lucide-react";

import { api } from "@/lib/api";
import {
  isServerUp,
  migrateLocalToServer,
  summarizeLocalData,
} from "@/lib/server-sync";
import { outbox } from "@/lib/outbox";
import { cn } from "@/lib/utils";

type ServerState = "checking" | "up" | "down";
type MigrationState = "idle" | "running" | "done" | "error";

export function ServerStatusBanner() {
  const [server, setServer] = useState<ServerState>("checking");
  const [migration, setMigration] = useState<MigrationState>("idle");
  // imported counts 不再展示 —— 成功是静默的。setter 保留,用于失败→成功重试时
  // 刷掉旧状态。
  const [, setImported] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outboxState, setOutboxState] = useState(() => outbox.snapshot());

  // 启动时探活 + **静默自动迁移**历史本地数据到后端(idempotent,每次启动重新
  // 对齐漂移)。与 outbox 的实时写入配合。失败才在下方出横幅。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const up = await isServerUp();
      if (cancelled) return;
      setServer(up ? "up" : "down");
      if (!up) return;

      const localNow = summarizeLocalData();
      const hasLocal =
        localNow.questions +
          localNow.conversations +
          localNow.evaluations +
          localNow.agents +
          localNow.settingsKeys >
        0;
      if (!hasLocal) return;

      setMigration("running");
      try {
        const res = await migrateLocalToServer();
        if (!cancelled) {
          setImported(res.imported);
          setMigration("done");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setMigration("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to outbox state changes for live count.
  useEffect(() => outbox.onChange(setOutboxState), []);

  if (server === "checking") return null;

  // ── Server down → degraded mode ──
  if (server === "down") {
    return (
      <Strip tone="warn">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>
          后端服务未连接(<code className="font-mono text-[11px]">{api.baseUrl}</code>),数据仅存本地浏览器。启动指引:
          <code className="ml-1 font-mono text-[11px]">
            cd server &amp;&amp; uv run uvicorn app.main:app --reload --port 18791
          </code>
        </span>
      </Strip>
    );
  }

  // ── Migration failed banner ── (success is silent)
  if (migration === "error" && error) {
    return (
      <Strip tone="warn">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>导入到 postgres 失败:{error}</span>
        <button
          className="ml-auto rounded px-2 py-0.5 text-[11px] hover:bg-foreground/10"
          onClick={() => {
            setMigration("idle");
            setError(null);
          }}
        >
          忽略
        </button>
      </Strip>
    );
  }

  // ── Outbox dead letters: show retry + clear ──
  if (outboxState.dead.length > 0) {
    return (
      <Strip tone="warn">
        <XCircle className="h-3.5 w-3.5" />
        <span>
          有 <strong>{outboxState.dead.length}</strong> 条数据持续保存失败(已重试 8 次)
        </span>
        <button
          className="ml-auto rounded bg-foreground px-2 py-0.5 text-[11px] font-medium text-background hover:bg-foreground/90"
          onClick={() => outbox.retryDead()}
        >
          <RefreshCw className="mr-1 inline-block h-3 w-3" />
          重新入队
        </button>
        <button
          className="rounded px-2 py-0.5 text-[11px] hover:bg-foreground/10"
          onClick={() => {
            if (
              confirm(
                `丢弃 ${outboxState.dead.length} 条失败的同步任务?\n(仅清理本地队列,已经入库的数据不受影响)`,
              )
            ) {
              outbox.clearDead();
            }
          }}
          title="把这些失败任务从队列里直接丢掉"
        >
          清空
        </button>
      </Strip>
    );
  }

  // ── Outbox pending(上行同步进行中)由全局 SyncStatusPill 统一展示(含下行 refetch），
  //    这里不再出右下角药丸,避免两处重复。 ──

  // ── Everything synced & no issues → nothing to surface. ──
  return null;
}

function Strip({
  tone,
  children,
}: {
  tone: "warn" | "info" | "ok" | "ok-quiet";
  children: React.ReactNode;
}) {
  const palette: Record<typeof tone, string> = {
    warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    info: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    "ok-quiet": "bg-muted/40 text-muted-foreground border-border",
  };
  return (
    <div
      className={cn(
        "flex min-h-7 shrink-0 flex-wrap items-center gap-2 gap-y-0.5 border-b px-3 py-0.5 text-[12px]",
        palette[tone],
      )}
    >
      {children}
    </div>
  );
}

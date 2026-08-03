#!/bin/bash
# eval-platform 本地开发三件套:Postgres(docker)+ 后端(FastAPI :18791)+ 前端(vite :5173)
# 用法: scripts/dev.sh [up|down [--db]|status]   (无参数 = up)
set -u

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
RUN_DIR="$ROOT/.run"
DB_CONTAINER="agent-evaluator-db-1"
BACKEND_URL="http://127.0.0.1:18791/"
FRONTEND_URL="http://localhost:5173/"   # vite 默认绑 IPv6 ::1,必须用 localhost 探活

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

alive() {  # $1=url → 0 表示有 HTTP 应答(404 也算活)
  curl -s -m 2 -o /dev/null "$1" 2>/dev/null
}

db_running() { docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER"; }

backend_healthy() {  # 真健康 = /health 返回 200;避免把残留/半死/正在关闭的进程当"已在跑"
  [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:18791/health 2>/dev/null)" = "200" ]
}

free_port() {  # $1=port $2=名字 —— 确保端口真释放:反复 TERM 占用进程直到空,超时 KILL 兜底
  local i pids
  for i in $(seq 1 12); do
    pids="$(lsof -ti tcp:"$1" 2>/dev/null)"
    [ -z "$pids" ] && return 0
    kill $pids 2>/dev/null
    sleep 0.5
  done
  pids="$(lsof -ti tcp:"$1" 2>/dev/null)"
  if [ -n "$pids" ]; then
    yellow "⚠ $2 端口 $1 顽固进程,强杀:$pids"; kill -9 $pids 2>/dev/null; sleep 1
  fi
}

tail_log() {
  yellow "---- $1 末尾 ----"
  tail -10 "$1" 2>/dev/null
}

wait_alive() {  # $1=url $2=名字 $3=log
  local i
  for i in $(seq 1 20); do
    alive "$1" && return 0
    sleep 1
  done
  red "✗ $2 20s 内未就绪"
  tail_log "$3"
  return 1
}

up_db() {
  if db_running; then green "✓ db        已在跑($DB_CONTAINER)"; return 0; fi
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER"; then
    if docker start "$DB_CONTAINER" >/dev/null; then
      green "✓ db        已启动($DB_CONTAINER)"; return 0
    fi
  fi
  yellow "⚠ db        容器 $DB_CONTAINER 不存在或 docker 未运行 —— 继续,但依赖库的接口会报错"
}

up_backend() {
  if backend_healthy; then green "✓ backend   已在跑(:18791,/health 200),跳过"; return 0; fi
  if [ ! -x "$ROOT/server/.venv/bin/python" ]; then
    red "✗ backend   缺 server/.venv —— 先在 server/ 下建 venv 并安装依赖"
    return 1
  fi
  # 走到这说明 backend 没在正常响应(上面 alive 没通过)。若 18791 仍被占,
  # 即上次没退干净的残留(常见:--reload 启动失败后父进程仍占端口)。不依赖
  # pid 文件,按端口 + 进程名清掉,避免新进程 "Address already in use"。
  local stale_pids
  stale_pids="$(lsof -ti tcp:18791 2>/dev/null)"
  if [ -n "$stale_pids" ] || pgrep -f "uvicorn app.main:app.*18791" >/dev/null 2>&1; then
    yellow "⚠ backend   18791 有残留进程(上次未退干净),清理后重启"
    [ -n "$stale_pids" ] && kill $stale_pids 2>/dev/null
    pkill -f "uvicorn app.main:app.*18791" 2>/dev/null
    sleep 1
  fi
  mkdir -p "$RUN_DIR"
  (cd "$ROOT/server" && nohup .venv/bin/python -m uvicorn app.main:app \
      --host 127.0.0.1 --port 18791 --reload \
      > "$RUN_DIR/backend.log" 2>&1 & echo $! > "$RUN_DIR/backend.pid")
  wait_alive "$BACKEND_URL" backend "$RUN_DIR/backend.log" || return 1
  green "✓ backend   就绪(:18791,--reload,pid $(cat "$RUN_DIR/backend.pid"))"
}

up_frontend() {
  if alive "$FRONTEND_URL"; then green "✓ frontend  已在跑(:5173),跳过"; return 0; fi
  if [ ! -d "$ROOT/node_modules" ]; then
    red "✗ frontend  缺 node_modules —— 先 npm install"
    return 1
  fi
  mkdir -p "$RUN_DIR"
  (cd "$ROOT" && nohup npm run dev > "$RUN_DIR/frontend.log" 2>&1 & echo $! > "$RUN_DIR/frontend.pid")
  wait_alive "$FRONTEND_URL" frontend "$RUN_DIR/frontend.log" || return 1
  green "✓ frontend  就绪(:5173,pid $(cat "$RUN_DIR/frontend.pid"))"
}

kill_one() {  # $1=pid文件 $2=兜底 pgrep 模式 $3=名字
  local pid
  if [ -f "$1" ]; then
    pid="$(cat "$1")"
    kill "$pid" 2>/dev/null && green "✓ $3 已停(pid $pid)"
    rm -f "$1"
    sleep 1
  fi
  if pgrep -f "$2" >/dev/null 2>&1; then
    yellow "兜底清理 $3:"
    pgrep -fl "$2"
    pkill -f "$2"
  fi
}

cmd_up() {
  up_db
  up_backend || exit 1
  up_frontend || exit 1
  echo
  green "全部就绪 → http://localhost:5173"
}

cmd_down() {
  kill_one "$RUN_DIR/backend.pid"  "uvicorn app.main:app.*18791"        backend
  free_port 18791 backend   # 确认 18791 真释放(graceful 关闭可能 >1s / --reload 子进程残留)
  kill_one "$RUN_DIR/frontend.pid" "node_modules/.bin/vite"             frontend
  free_port 5173 frontend   # 兜底按端口回收前端(pgrep 模式不一定匹配 vite/node)
  if [ "${1:-}" = "--db" ]; then
    if docker stop "$DB_CONTAINER" >/dev/null 2>&1; then green "✓ db 已停"; else yellow "⚠ db 未在跑"; fi
  else
    yellow "db 保持运行(要停:scripts/dev.sh down --db)"
  fi
}

cmd_status() {
  local ok=0
  if db_running;            then green "✓ db        $DB_CONTAINER"; else red "✗ db        $DB_CONTAINER"; ok=1; fi
  if alive "$BACKEND_URL";  then green "✓ backend   :18791";        else red "✗ backend   :18791";        ok=1; fi
  if alive "$FRONTEND_URL"; then green "✓ frontend  :5173";         else red "✗ frontend  :5173";         ok=1; fi
  return $ok
}

case "${1:-up}" in
  up)     cmd_up ;;
  down)   cmd_down "${2:-}" ;;
  status) cmd_status ;;
  *)      echo "用法: scripts/dev.sh [up|down [--db]|status]"; exit 2 ;;
esac

#!/usr/bin/env bash
# 一键部署:后端(docker compose: db + server)+ 前端(构建到 dist,由宿主机 nginx 直接托管)。
# 前端走同源相对路径(VITE_SERVER_URL=""),由宿主机 nginx 反代 /v1 /admin /health 到 127.0.0.1:18791。
# 用法(在仓库根):  ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> [1/3] 起后端容器(db + server)"
docker compose up -d --build

echo "==> [2/3] 构建前端到 dist/"
# 首次或锁文件变化时装依赖;node_modules 已存在则跳过(加 --no-deps 跳过:FORCE_NPM=0)
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm ci
fi
VITE_SERVER_URL="" npm run build

echo "==> [3/3] 等待后端健康检查"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:18791/health >/dev/null 2>&1; then
    echo "    后端就绪 ✓"
    break
  fi
  [ "$i" = "30" ] && { echo "    后端 60s 内未就绪,看日志:docker compose logs -f server"; exit 1; }
  sleep 2
done

echo "==> 部署完成。前端 dist/ 已就绪,nginx 直接托管;无需 reload(root 指向本 dist)。"

#!/usr/bin/env bash
# 在【部署主机】上把 GATEWAY_*(Dex / Gateway 网关)写进根 .env 并重建 server 容器。
# 解决「部署后平台显示:未配置 GATEWAY_BASE_URL / GATEWAY_API_KEY」—— 根因是 .env 被
# gitignore、不随代码上线,所以部署主机的 .env 缺这些值。
#
# 特性:幂等(可反复跑,已存在的键就地替换,不追加重复);API Key 不落进脚本/不回显;
#       改动前自动备份 .env;完成后重建 server 容器并做健康检查。
#
# 用法(在仓库根,即 docker-compose.yml 所在目录):
#   ./scripts/setup-gateway-env.sh                      # 交互式输入 API Key
#   GATEWAY_API_KEY=sk-... ./scripts/setup-gateway-env.sh   # 非交互(CI/免输入)
# 可选覆盖(默认值见下):GATEWAY_BASE_URL / GATEWAY_MODEL / GATEWAY_REQUEST_TIMEOUT
set -euo pipefail

# 定位到仓库根(本脚本在 scripts/ 下)
cd "$(dirname "$0")/.."
ENV_FILE=".env"

# 非密钥项:给默认值,可用环境变量覆盖
GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-https://gateway.example.com/dex}"
GATEWAY_MODEL="${GATEWAY_MODEL:-dex}"
GATEWAY_REQUEST_TIMEOUT="${GATEWAY_REQUEST_TIMEOUT:-300}"

echo "==> [1/4] 前置检查"
if [ ! -f "$ENV_FILE" ]; then
  echo "    ✗ 找不到 $ENV_FILE。请先按 .env.docker.example 建好 .env 再跑本脚本。" >&2
  exit 1
fi
if [ ! -f docker-compose.yml ]; then
  echo "    ✗ 当前目录没有 docker-compose.yml,请在仓库根运行。" >&2
  exit 1
fi
# 兼容 docker compose v2(docker compose)与 v1(docker-compose)
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else echo "    ✗ 没找到 docker compose / docker-compose。" >&2; exit 1
fi
echo "    使用:$DC"

echo "==> [2/4] 收集 API Key"
if [ -z "${GATEWAY_API_KEY:-}" ]; then
  printf "    请输入 GATEWAY_API_KEY(输入不回显,来自本地 server/.env 的同名值):"
  read -rs GATEWAY_API_KEY
  printf "\n"
fi
if [ -z "${GATEWAY_API_KEY:-}" ]; then
  echo "    ✗ GATEWAY_API_KEY 为空,已中止(未改动 .env)。" >&2
  exit 1
fi

echo "==> [3/4] 写入 $ENV_FILE(先备份)"
backup="${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$backup"
echo "    已备份 → $backup"

# upsert KEY VALUE:.env 里有 ^KEY= 则就地替换整行,否则追加;值可含 = 号。
upsert() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$val" '
      $0 ~ "^" k "=" { print k "=" v; found=1; next }
      { print }
      END { if (!found) print k "=" v }
    ' "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

upsert GATEWAY_BASE_URL "$GATEWAY_BASE_URL"
upsert GATEWAY_API_KEY "$GATEWAY_API_KEY"
upsert GATEWAY_MODEL "$GATEWAY_MODEL"
upsert GATEWAY_REQUEST_TIMEOUT "$GATEWAY_REQUEST_TIMEOUT"

# 回显时对 Key 打码(只露首尾各 4 位),不整段打印密钥
masked="$(printf '%s' "$GATEWAY_API_KEY" | sed -E 's/^(.{4}).*(.{4})$/\1…\2/')"
echo "    BASE_URL = $GATEWAY_BASE_URL"
echo "    MODEL    = $GATEWAY_MODEL"
echo "    TIMEOUT  = $GATEWAY_REQUEST_TIMEOUT"
echo "    API_KEY  = $masked  (已写入,未明文回显)"

echo "==> [4/4] 重建 server 容器并等健康检查"
# 注意:必须 up -d(重建容器读新 env),restart 不会重读 env_file。
$DC up -d server
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:18791/health >/dev/null 2>&1; then
    echo "    后端就绪 ✓"
    break
  fi
  [ "$i" = "30" ] && { echo "    ✗ 60s 内未就绪,看日志:$DC logs -f server" >&2; exit 1; }
  sleep 2
done

echo
echo "✓ 完成。请刷新平台,Dex / Gateway 的连接状态应从「未配置」转正常。"
echo "  说明:/v1/gateway/ping 需登录鉴权,别用裸 curl 测,直接看平台 UI 即可。"
echo "  如需回滚:cp \"$backup\" \"$ENV_FILE\" && $DC up -d server"

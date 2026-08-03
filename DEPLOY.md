# 部署说明(后端 Docker Compose + 宿主机 nginx)

当前部署模型:**后端两个容器**(`db` Postgres + `server` FastAPI)由 docker compose 起;**前端**用 `npm run build` 产出 `dist/`,由**宿主机 nginx** 直接托管,并反代 `/v1 /admin /health` 到后端 + 处理 HTTPS。`server` 只监听 `127.0.0.1:18791`(不对公网),`db` 仅 compose 内网可达。

> 历史:早期曾用「db + server + web(容器内 nginx)+ 8080」三容器模型;现已改为本文档的「后端 compose + 宿主机 nginx」。`./deploy.sh` 一键串起整套。

## 一、架构 / 端口

```
浏览器 ──HTTPS:443──> [宿主机 nginx]
                        ├─ 托管静态 SPA(<仓库>/dist;/、/skills、/reports/:id 由 SPA 回退)
                        └─ 反代 /v1 /admin /health ──> 127.0.0.1:18791 ──> [server: FastAPI(容器)]
                                                                                ├─ ──> [db: Postgres(容器,db:5432)]
                                                                                └─ 代理 ──> Platform 开放平台 / Google OAuth
```

- `server` 容器端口写死 `18791`,只映射到宿主机回环 `127.0.0.1:18791`。
- `db` 不发布端口,仅容器内 `db:5432` 可达;`DATABASE_URL` 由 compose 自动拼好(**不要在 `.env` 里设它**)。
- SSE(platform 聊天 `/v1/platform/chat`)需在 nginx 关闭缓冲、放宽超时(见下方参考配置)。

## 二、目标服务器准备

- 安装 **Docker** + **Docker Compose**(`docker compose version` 有输出即可)。
- 安装并能管理 **宿主机 nginx**;准备好域名 + HTTPS 证书(如 certbot / Let's Encrypt)。
- 服务器需能**对外访问** Platform 开放平台与 Google OAuth(后端要代理调用)。
- 防火墙 / 安全组放行 `443`(和用于签证书的 `80`)。

## 三、首次部署

```bash
# 1) 拿到代码(部署分支通常是 develop)
git clone <仓库地址> eval-platform
cd eval-platform
git checkout develop

# 2) 准备环境变量(见第四节;登录系统的变量必须填全,否则没人能登录)
cp .env.docker.example .env
vim .env

# 3) (含登录系统首次上线 / 有 schema 变更时)干净库起步 —— 见第六节「数据库」
#    全新服务器可跳过这步。
docker compose down -v        # ⚠️ 删除数据卷 qa_pgdata,先备份!

# 4) 一键部署:起 db+server → 构建 dist/ → 等后端健康检查
./deploy.sh

# 5) 配置宿主机 nginx(第五节)+ 证书,reload
sudo nginx -t && sudo systemctl reload nginx

# 6) 验证
docker compose ps                              # db、server 都 Up (healthy)
curl -s http://127.0.0.1:18791/health          # {"status":"ok",...}
curl -sI https://<你的域名>/health             # 经 nginx 也应 200
```

浏览器打开 `https://<你的域名>`:未登录会跳登录页 → 点 **Google 登录**(任意 Google 账号首登自动建号)→ 进首页 → 个人信息里**设置密码**(之后可用「邮箱 + 密码」登录)。

## 四、`.env` 变量说明

> 经 compose 的 `env_file: .env` 注入 `server` 容器。**不要设 `DATABASE_URL`**(由 `POSTGRES_*` 自动拼成 `@db:5432`)。`SERVER_TOKEN` 已退役,留空。

### 基础(必填项见标注)
| 变量 | 说明 |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | **必填**(密码仅 ASCII:字母数字 `-_.`,别用中文 / `@ : /`) |
| `SERVER_TOKEN` | 已退役,**留空**(鉴权改走登录会话) |
| `CORS_ORIGINS` | 同源部署保持 `*` |
| `PLATFORM_BASE_URL` / `PLATFORM_API_KEY` | **必填**,后端代理 platform 用 |
| `PLATFORM_NAMESPACE` / `PLATFORM_REQUEST_TIMEOUT` | 默认 `/open/agent` / `300` |
| `CAPTURE_TOOL_IO` | 默认 `false`(脱敏);`true` 才把工具 I/O 落库并喂裁判 |
| `SKILLOPT_REQUEST_TIMEOUT` | SkillOpt 子进程超时(秒),默认 `1800` |
| `SAGE_REPO_HOST_PATH` | 可选;指向服务器上 clone 的 agent-defs,启用「技能源 / 对比」只读页 |
| `WEB_PORT` | **旧三容器模型遗留,新模型忽略** |

### 登录 / 鉴权(上线必配,否则锁死)
| 变量 | 说明 |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | **必填**。Google 是当前唯一建号通道(无 `/register` 接口) |
| `GOOGLE_REDIRECT_URI` | **必填**,`https://<域名>/v1/auth/google/callback`,须与 Google Console 登记的**逐字一致** |
| `SESSION_COOKIE_SECURE` | 生产(HTTPS)**必须 `true`**;否则登录后 cookie 不下发、立刻掉线 |
| `SESSION_TTL_DAYS` | 会话有效天数,默认 `30` |
| `APP_BASE_URL` | `https://<域名>`,拼「忘记密码」重置链接用 |
| `GMAIL_SMTP_USER` / `GMAIL_SMTP_APP_PASSWORD` / `MAIL_FROM` | 可选;要发「忘记密码」邮件才填(Gmail SMTP) |
| `RESET_TOKEN_TTL_MINUTES` | 重置链接有效分钟,默认 `30` |
| `AUTH_ALLOWED_EMAILS` / `AUTH_ALLOWED_EMAIL_DOMAINS` | ⚠️ **当前未接入任何路由**(Google 回调不查名单),设了也不生效;留空 |

**Google Cloud Console** 侧需配(末尾不带斜杠):
- 已授权的重定向 URI:`https://<域名>/v1/auth/google/callback`
- 已授权的 JavaScript 来源:`https://<域名>`

> ⚠️ 安全提醒:当前 allowlist 未生效,**任意 Google 账号都能登录并拿到独立数据**。要限制谁能登录,需另改代码把 allowlist 接进 Google 回调。

## 五、宿主机 nginx 参考配置

放到 `/etc/nginx/sites-available/<域名>.conf`(或 `conf.d/`),改好 `root` 与证书路径后 `ln -s` + `nginx -t` + `reload`。

```nginx
server {                       # HTTP → HTTPS
    listen 80;
    server_name <你的域名>;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name <你的域名>;

    ssl_certificate     /etc/letsencrypt/live/<你的域名>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<你的域名>/privkey.pem;

    root /opt/eval-platform/dist;   # ← 换成你仓库的真实路径 + /dist
    index index.html;
    client_max_body_size 25m;

    location / { try_files $uri $uri/ /index.html; }   # SPA 回退

    location /v1/ {                                     # REST + SSE
        proxy_pass http://127.0.0.1:18791;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off; proxy_cache off;           # SSE 必须关缓冲
        proxy_read_timeout 3600s;
        chunked_transfer_encoding on;
    }
    location /admin/ {
        proxy_pass http://127.0.0.1:18791;
        proxy_http_version 1.1;
        proxy_set_header Host            $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location = /health { proxy_pass http://127.0.0.1:18791; }
}
```

> 没证书:`sudo certbot --nginx -d <你的域名>` 会自动补好 `ssl_certificate*` 两行。

## 六、数据库

表结构在后端启动时自动建(SQLModel `create_all`);`db.py` 启动还会**自动补回模型新增、旧库缺失的列**(只增、NULLABLE)。

⚠️ **但 `create_all` / 补列都不会改主键**。登录系统把 `prompts`(`owner_user_id,id`)和 `settings`(`owner_user_id,key`)改成了**复合主键**,旧库这两张表保持旧单列主键 → 按用户隔离会失准。**故首次上线登录系统、或涉及主键变更时,采用「干净库起步」**(`docker compose down -v` 清卷后重建)。

数据在命名卷 `qa_pgdata`(`down` 不删,`down -v` 才删)。
```bash
# 备份(用容器自带 env,免手填账号)
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" --clean --if-exists "$POSTGRES_DB"' > backup_$(date +%F).sql
# 恢复
cat backup.sql | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```
> 注:旧 schema(无 `owner_user_id`、单列主键)的备份**灌不回新版**,仅作存档。

**查看库内容**(db 端口不对外,经容器进):
```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
# 进 psql 后:\dt 列表;SELECT email,name,status,created_at FROM users;  \q 退出
```

## 七、日常运维

```bash
docker compose logs -f server     # 后端日志
docker compose logs -f db         # 数据库日志
docker compose restart server     # 重启后端
docker compose ps                 # 看状态 / 健康
docker compose down               # 停(保留数据卷)
```

## 八、升级到新版本

```bash
git pull                          # 拉最新代码
./deploy.sh                       # 重新构建 server 镜像 + 重建 dist + 等健康
# 若改过 nginx:sudo nginx -t && sudo systemctl reload nginx
```
- 一般数据卷保留、平滑升级;新增列由启动自动补。
- **若本次升级含主键 / 隔离变更**(如本登录系统首发),需按第六节「干净库起步」处理。
- 前端在 build 时以**同源相对路径**访问后端(`VITE_SERVER_URL=""`,deploy.sh 已设),无需额外配置。

## 九、上线自检清单

- [ ] `.env` 填全:`POSTGRES_*` / `PLATFORM_*` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` / `SESSION_COOKIE_SECURE=true` / `APP_BASE_URL`;**未设 `DATABASE_URL`**
- [ ] `docker compose config | grep DATABASE_URL` 显示 `@db:5432`(不是别的端口)
- [ ] Google Console 重定向 URI / JS 来源已登记,与 `.env` 逐字一致
- [ ] `docker compose ps`:db、server 均 `Up (healthy)`
- [ ] `curl https://<域名>/health` 200;`curl https://<域名>/v1/auth/me` 返回 401(不是 502)
- [ ] 浏览器 Google 登录建号 → 设密码 → 邮箱+密码可登

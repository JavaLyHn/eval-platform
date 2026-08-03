# ── 前端镜像:Vite 构建 → nginx 托管静态站 + 反代后端 ──
#
# 前端只通过 VITE_SERVER_URL 访问后端;部署时用空串 "" 走「同源相对路径」,
# 由 nginx 把 /v1 /admin /health 反代到 server 容器,免 CORS、不写死服务器 IP。
# SERVER_TOKEN 非空时需把 VITE_SERVER_TOKEN 作为 build arg 一并 build 进来。

FROM node:20-alpine AS build
WORKDIR /app

# 先装依赖(利用层缓存)
COPY package.json package-lock.json ./
RUN npm ci

# 拷源码并构建。VITE_* 在 build 时被静态烘焙进产物。
COPY . .
ARG VITE_SERVER_URL=""
ARG VITE_SERVER_TOKEN=""
ENV VITE_SERVER_URL=$VITE_SERVER_URL \
    VITE_SERVER_TOKEN=$VITE_SERVER_TOKEN
RUN npm run build

# ── 运行阶段:nginx 托管 dist + 反代 ──
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

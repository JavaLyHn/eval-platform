import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true, // 监听所有网卡，允许局域网设备访问
    port: 5173,
    // 同源代理:让后端 Cookie 成为第一方(与 prod 的宿主机 nginx 同源一致)。
    proxy: {
      "/v1": { target: "http://127.0.0.1:18791", changeOrigin: true },
      "/admin": { target: "http://127.0.0.1:18791", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:18791", changeOrigin: true },
    },
  },
});

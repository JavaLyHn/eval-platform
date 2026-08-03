/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API base;留空 = 同源相对路径(dev 经 vite 代理,prod 经 nginx)。 */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

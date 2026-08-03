from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/qa_platform"
    server_port: int = 18791
    server_token: str = ""
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    platform_base_url: str = ""
    platform_api_key: str = ""
    platform_request_timeout: int = 300
    platform_namespace: str = "/open/agent"

    # Gateway / OpenAI 兼容网关接入(被测 agent,如 dex「Dex」)。
    # 该网关不发 CORS 头 → 浏览器直连被拦;故走后端代理(server→server 无 CORS)。
    # base_url 不含 /v1/...(代理自动补);给默认值 = 已知网关(非密钥),所以部署机
    # 只需提供 API Key。key 来源:① 前端 profile 配置(随请求体传来,优先)② 本 .env 兜底。
    gateway_base_url: str = "https://gateway.example.com/dex"
    gateway_api_key: str = ""
    gateway_model: str = "dex"
    gateway_request_timeout: int = 300

    # 评测线工具内容可见性:默认 False = 沿用脱敏(非白名单工具 I/O 落库前剔除)。
    # True = normalize_transcript 对所有工具保留「截断 + 脱密」的 I/O 片段,供 judge 判「内容对不对」。
    # 打开 = 显式同意工具内容落库并流向(可能第三方的)裁判 LLM;脱密为尽力而为、非保证。
    capture_tool_io: bool = False

    # SkillOpt 子进程编排:SkillOpt 仓库根 + 它自己的 venv python。
    # 留空 → 用仓库内 ../SkillOpt(相对 server/);可用 env SKILLOPT_DIR 覆盖。
    skillopt_dir: str = ""
    skillopt_request_timeout: int = 1800

    # agent-defs 本地 clone(AI 员工源定义),只读浏览/对比用。
    agent_repo_dir: str = ""

    # --- 鉴权 / 会话 / 邮件(登录系统)---
    # 允许名单:两者都为空 = 注册关闭。
    auth_allowed_emails: str = ""          # 逗号分隔的具体邮箱
    auth_allowed_email_domains: str = ""   # 逗号分隔的域名(如 example.com)
    session_cookie_secure: bool = False    # prod 置 true(HTTPS)
    session_ttl_days: int = 30
    reset_token_ttl_minutes: int = 30
    # 忘记密码邮件(Gmail SMTP)
    gmail_smtp_user: str = ""
    gmail_smtp_app_password: str = ""
    mail_from: str = ""
    app_base_url: str = ""                 # 拼重置链接,如 https://app.example.com

    # Google 登录(OAuth2 授权码流)。三项齐全才启用;留空则「未配置」分支。
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""          # 如 dev http://localhost:5173/v1/auth/google/callback

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def skillopt_root(self) -> str:
        from pathlib import Path
        if self.skillopt_dir:
            return str(Path(self.skillopt_dir).expanduser())
        # server/app/config.py → 仓库根 = parents[2];SkillOpt 在其下
        return str(Path(__file__).resolve().parents[2] / "SkillOpt")

    @property
    def skillopt_python(self) -> str:
        from pathlib import Path
        return str(Path(self.skillopt_root) / ".venv" / "bin" / "python")

    @property
    def agent_repo_root(self) -> str:
        from pathlib import Path
        if self.agent_repo_dir:
            return str(Path(self.agent_repo_dir).expanduser())
        return str(Path(__file__).resolve().parents[2] / "agent-defs")


settings = Settings()

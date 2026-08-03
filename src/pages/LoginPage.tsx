import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { validateEmail } from "@/lib/auth-validate";
import { forgetEmail, getKnownEmails, rememberEmail } from "@/lib/auth-local";

// 后端 Google 回调失败时会 302 回 /login?error=<code>;这里翻译成中文提示。
const GOOGLE_ERRORS: Record<string, string> = {
  google_not_configured: "Google 登录尚未配置(需先填入 OAuth 凭据)",
  google_failed: "Google 登录失败,请重试",
  google_state: "Google 登录校验失败,请重试",
};

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 本机登录过的邮箱(仅邮箱),用于「切换账号」快捷回填。
  const [known, setKnown] = useState<string[]>(() => getKnownEmails());

  const panelRef = useRef<HTMLElement>(null);
  const netRef = useRef<HTMLCanvasElement>(null);

  const googleError = GOOGLE_ERRORS[searchParams.get("error") ?? ""] ?? null;
  const shownError = error ?? googleError;
  const emailValid = validateEmail(email);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validateEmail(email)) return setError("邮箱格式不正确");
    // 登录不校验密码长度策略(那是「设置新密码」才管的);非空即可,真伪交后端判。
    if (!password) return setError("请输入密码");
    setLoading(true);
    try {
      await api.auth.login(email.trim().toLowerCase(), password);
      rememberEmail(email); // 记住本机登录过的邮箱,供下次「切换账号」快捷回填
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      // request 已抽出后端 detail(如「邮箱或密码错误」)当 message,直接显示即可。
      setError(err instanceof Error ? err.message : "登录失败,请重试");
    } finally {
      setLoading(false);
    }
  };

  // 整页跳转到后端 OAuth 入口(它再 302 到 Google;凭据未配置则 302 回带 error 的本页)。
  const signInWithGoogle = () => {
    window.location.href = "/v1/auth/google/login";
  };

  // ── 左侧面板的「裁判给核心打分」节点网络(canvas)+ 鼠标视差/聚光 ──────────
  // 浮动节点 + 邻近连线 + 沿连线游走的脉冲(走到节点就点亮它)。纯装饰,
  // 尊重 prefers-reduced-motion(只画一帧静态图)。组件卸载时清理 rAF/监听器。
  useEffect(() => {
    const canvas = netRef.current;
    const panel = panelRef.current;
    if (!canvas || !panel) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    interface Node {
      nx: number; ny: number; ax: number; ay: number;
      px: number; py: number; sx: number; sy: number;
      r: number; core: boolean; flash: number; x: number; y: number;
    }
    interface Pulse { a: number; b: number; t: number; sp: number }

    let W = 0, H = 0, DPR = 1;
    let nodes: Node[] = [];
    const pulses: Pulse[] = [];
    const mouse = { tx: 0, ty: 0, cx: 0, cy: 0 };
    let last = 0, spawnAt = 0, raf = 0, rt = 0;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    function build() {
      const rect = canvas!.getBoundingClientRect();
      W = rect.width; H = rect.height;
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(W * DPR);
      canvas!.height = Math.round(H * DPR);
      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);

      const count = Math.max(12, Math.min(28, Math.round((W * H) / 24000)));
      nodes = [];
      for (let i = 0; i < count; i++) {
        const core = i < 2; // 两个更亮的「核心」节点
        nodes.push({
          nx: rand(0.08, 0.92), ny: rand(0.1, 0.92),
          ax: rand(8, 20), ay: rand(8, 20),
          px: rand(0, Math.PI * 2), py: rand(0, Math.PI * 2),
          sx: rand(0.15, 0.4), sy: rand(0.15, 0.4),
          r: core ? 2.8 : rand(1.1, 2.0),
          core, flash: 0, x: 0, y: 0,
        });
      }
    }

    const link = () => Math.max(110, Math.min(190, Math.min(W, H) * 0.34));

    function positions(t: number) {
      const px = mouse.cx, py = mouse.cy;
      for (const n of nodes) {
        const depth = (n.r - 1) * 8; // 越大的节点视差越强
        n.x = n.nx * W + Math.sin(t * n.sx + n.px) * n.ax + px * depth;
        n.y = n.ny * H + Math.cos(t * n.sy + n.py) * n.ay + py * depth;
      }
    }

    function connectedPairs(LD: number): Array<[number, number, number]> {
      const out: Array<[number, number, number]> = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < LD) out.push([i, j, d]);
        }
      }
      return out;
    }

    function draw(pairs: Array<[number, number, number]>, LD: number) {
      ctx!.clearRect(0, 0, W, H);
      ctx!.lineWidth = 1;
      for (const [ai, bi, d] of pairs) {
        const a = nodes[ai], b = nodes[bi];
        const alpha = (1 - d / LD) * 0.42;
        ctx!.strokeStyle = `rgba(130,165,255,${alpha.toFixed(3)})`;
        ctx!.beginPath(); ctx!.moveTo(a.x, a.y); ctx!.lineTo(b.x, b.y); ctx!.stroke();
      }
      for (const n of nodes) {
        const glow = (n.core ? 12 : 7) + n.flash * 14;
        ctx!.shadowColor = n.core ? "rgba(150,190,255,.95)" : "rgba(106,160,255,.85)";
        ctx!.shadowBlur = glow;
        ctx!.fillStyle = n.core
          ? `rgba(214,230,255,${0.85 + n.flash * 0.15})`
          : `rgba(150,185,255,${0.55 + n.flash * 0.4})`;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r + n.flash * 1.6, 0, Math.PI * 2);
        ctx!.fill();
        n.flash *= 0.92;
      }
      ctx!.shadowBlur = 0;
      for (let p = pulses.length - 1; p >= 0; p--) {
        const pu = pulses[p];
        const na = nodes[pu.a], nb = nodes[pu.b];
        pu.t += pu.sp;
        const x = na.x + (nb.x - na.x) * pu.t, y = na.y + (nb.y - na.y) * pu.t;
        ctx!.shadowColor = "rgba(120,180,255,1)"; ctx!.shadowBlur = 14;
        ctx!.fillStyle = "rgba(220,235,255,.95)";
        ctx!.beginPath(); ctx!.arc(x, y, 1.9, 0, Math.PI * 2); ctx!.fill();
        ctx!.shadowBlur = 0;
        if (pu.t >= 1) { nb.flash = 1; pulses.splice(p, 1); }
      }
    }

    function frame(ts: number) {
      if (!last) last = ts;
      last = ts;
      const t = ts / 1000;
      const LD = link();
      mouse.cx += (mouse.tx - mouse.cx) * 0.06;
      mouse.cy += (mouse.ty - mouse.cy) * 0.06;
      positions(t);
      const pairs = connectedPairs(LD);
      if (ts > spawnAt && pairs.length) {
        const e = pairs[(Math.random() * pairs.length) | 0];
        let a = e[0], b = e[1];
        if (Math.random() < 0.5) { const tmp = a; a = b; b = tmp; } // 随机方向
        pulses.push({ a, b, t: 0, sp: rand(0.012, 0.024) });
        spawnAt = ts + rand(650, 1300);
      }
      draw(pairs, LD);
      raf = requestAnimationFrame(frame);
    }

    function start() {
      build();
      if (reduce) {
        positions(0);
        draw(connectedPairs(link()), link()); // 单帧静态图
        return;
      }
      cancelAnimationFrame(raf);
      last = 0; spawnAt = 0;
      raf = requestAnimationFrame(frame);
    }

    const onMove = (e: MouseEvent) => {
      const r = panel.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      mouse.tx = (nx - 0.5) * 2;
      mouse.ty = (ny - 0.5) * 2;
      panel.style.setProperty("--mx", `${(nx * 100).toFixed(1)}%`);
      panel.style.setProperty("--my", `${(ny * 100).toFixed(1)}%`);
    };
    const onLeave = () => { mouse.tx = 0; mouse.ty = 0; };
    const onResize = () => { window.clearTimeout(rt); rt = window.setTimeout(start, 180); };

    panel.addEventListener("mousemove", onMove);
    panel.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", onResize);
    start();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(rt);
      panel.removeEventListener("mousemove", onMove);
      panel.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div className="login-screen">
      <style>{LOGIN_CSS}</style>
      <div className="auth">
        {/* 左:深色品牌面板 */}
        <aside className="panel" ref={panelRef}>
          <canvas className="net" ref={netRef} aria-hidden="true" />
          <div className="spotlight" aria-hidden="true" />

          <div className="brand">
            <span className="mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.519 2.365a.5.5 0 0 1 .962 0l1.583 6.135A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.064a2 2 0 0 0-1.436 1.435l-1.583 6.136a.5.5 0 0 1-.962 0L9.936 15.5A2 2 0 0 0 8.5 14.064l-6.135-1.583a.5.5 0 0 1 0-.962L8.5 9.937A2 2 0 0 0 9.936 8.5z" />
              </svg>
            </span>
            <span className="name">QA Platform</span>
          </div>

          <div className="pitch">
            <p className="eyebrow">Agent Evaluation Platform</p>
            <h1>
              给每一个 Agent,
              <br />
              一套可信的考核标准。
            </h1>
            <p className="lead">
              把 Agent 的每一次回答,经多次试验与交叉评判,变成可量化、可复现、可追溯的分数与发版结论。
            </p>
          </div>

          <div className="panel-foot">
            <span className="status">
              <span className="live" aria-hidden="true" />
              全部系统正常
            </span>
            <span>© 2026 QA Platform</span>
          </div>
        </aside>

        {/* 右:登录表单 */}
        <main className="form-wrap">
          <form className="form" onSubmit={submit} noValidate autoComplete="on">
            <h2>登录</h2>
            <p className="subtitle">欢迎回来,继续你的评测工作。</p>

            <div className={emailValid ? "field is-valid" : "field"}>
              <div className="field-head">
                <label htmlFor="email">Email</label>
              </div>
              <div className="control with-check">
                <input
                  className="input"
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  onChange={(e) => setEmail(e.target.value)}
                />
                <svg
                  className="valid-check"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>

            {known.length > 0 && (
              <div className="accounts">
                <span className="accounts-label">最近登录 · 点击切换账号</span>
                <div className="accounts-list">
                  {known.map((e) => (
                    <span
                      key={e}
                      className={
                        "chip" +
                        (e === email.trim().toLowerCase() ? " is-active" : "")
                      }
                    >
                      <button
                        type="button"
                        className="chip-main"
                        onClick={() => {
                          setEmail(e);
                          setError(null);
                          document.getElementById("password")?.focus();
                        }}
                        title={e}
                      >
                        {e}
                      </button>
                      <button
                        type="button"
                        className="chip-x"
                        aria-label={`移除 ${e}`}
                        onClick={() => {
                          forgetEmail(e);
                          setKnown(getKnownEmails());
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="field">
              <div className="field-head">
                <label htmlFor="password">Password</label>
              </div>
              <div className="control with-toggle">
                <input
                  className="input"
                  id="password"
                  name="password"
                  type={showPwd ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="输入你的密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="toggle"
                  tabIndex={-1}
                  aria-pressed={showPwd}
                  aria-label={showPwd ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPwd((v) => !v)}
                >
                  {showPwd ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </div>

            {shownError && (
              <p className="form-error" role="alert">
                {shownError}
              </p>
            )}

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "登录中…" : "使用密码登录"}
            </button>

            <div className="divider">或</div>

            {/* 使用 Google 登录 —— 没有账号的人由此首次登录自动建号 */}
            <button
              type="button"
              className="btn btn-google"
              onClick={signInWithGoogle}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.1a6.6 6.6 0 0 1 0-4.22V7.04H2.18a11 11 0 0 0 0 9.92l3.66-2.86Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
                />
              </svg>
              使用 Google 登录
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}

/* 登录页专属样式(参考 Downloads/login (1).html)。整页自成体系、固定浅色表单 + 深色品牌面板,
   不随应用深色模式切换。选择器统一挂在 .login-screen 下,避免泄漏到全局。 */
const LOGIN_CSS = `
.login-screen{
  --bg:#ffffff;--ink:#0b1220;--ink-soft:#4a5568;--muted:#94a3b8;
  --line:#e6e9ef;--line-strong:#d6dbe4;
  --brand:#3b6ff6;--brand-deep:#2348c8;--brand-bright:#6aa0ff;
  --btn:#0b1220;--btn-hover:#161f37;
  --panel-base:#0b1322;--panel-deep:#070b14;
  --on-dark:#e8edf6;--on-dark-soft:#8c98ae;--on-dark-faint:#5b667d;
  --ok:#16a34a;--danger:#e5484d;
  --radius-field:11px;--radius-btn:11px;
  --lp-sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  --lp-mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;
  font-family:var(--lp-sans);color:var(--ink);background:var(--bg);
  -webkit-font-smoothing:antialiased;
  /* 整页文案一律不可选中(只读观感);仅输入框例外,见下方。 */
  -webkit-user-select:none;user-select:none;
}
.login-screen *{box-sizing:border-box;}
/* 仅输入框保留可选中 —— 否则邮箱 / 密码无法拖选编辑、全选清空。其余文字皆不可选。 */
.login-screen input,.login-screen .input{
  -webkit-user-select:text;user-select:text;cursor:text;
}
.login-screen .auth{display:flex;min-height:100dvh;}

/* 左:深色品牌面板 */
.login-screen .panel{
  position:relative;flex:1 1 46%;overflow:hidden;
  display:flex;flex-direction:column;justify-content:space-between;
  padding:48px 52px;color:var(--on-dark);
  background:
    radial-gradient(115% 85% at 16% 6%, rgba(59,111,246,.20), transparent 52%),
    radial-gradient(95% 75% at 92% 96%, rgba(35,72,200,.18), transparent 58%),
    linear-gradient(158deg,var(--panel-base),var(--panel-deep));
}
.login-screen .panel::before{
  content:"";position:absolute;inset:0;z-index:0;
  background-image:
    linear-gradient(to right, rgba(255,255,255,.030) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,.030) 1px, transparent 1px);
  background-size:56px 56px;
  -webkit-mask-image:radial-gradient(120% 100% at 30% 20%, #000 0%, transparent 75%);
          mask-image:radial-gradient(120% 100% at 30% 20%, #000 0%, transparent 75%);
  pointer-events:none;
}
.login-screen .net{position:absolute;inset:0;z-index:0;width:100%;height:100%;pointer-events:none;}
.login-screen .spotlight{
  position:absolute;inset:0;z-index:1;pointer-events:none;opacity:0;
  background:radial-gradient(240px 240px at var(--mx,28%) var(--my,16%), rgba(106,160,255,.16), transparent 68%);
  transition:opacity .5s ease;
}
.login-screen .panel:hover .spotlight{opacity:1;}
.login-screen .panel .brand,
.login-screen .panel .pitch,
.login-screen .panel .panel-foot{position:relative;z-index:3;}

.login-screen .brand{display:flex;align-items:center;gap:12px;animation:lpRise .6s cubic-bezier(.2,.7,.3,1) both;}
.login-screen .mark{
  width:38px;height:38px;border-radius:11px;display:grid;place-items:center;
  background:linear-gradient(140deg,#5c93ff 0%,#2f5be6 55%,#2142c4 100%);
  box-shadow:0 8px 24px -8px rgba(47,91,230,.7), inset 0 1px 0 rgba(255,255,255,.35);
  flex:none;
}
.login-screen .mark svg{width:22px;height:22px;color:#fff;animation:lpSpin 26s linear infinite;}
.login-screen .brand .name{font-weight:600;font-size:17px;letter-spacing:.2px;color:#fff;}

.login-screen .pitch{max-width:430px;animation:lpRise .6s cubic-bezier(.2,.7,.3,1) .12s both;}
.login-screen .eyebrow{
  font-family:var(--lp-mono);font-size:11px;font-weight:500;letter-spacing:.22em;
  text-transform:uppercase;color:var(--brand-bright);margin:0 0 18px;
}
.login-screen .pitch h1{
  font-size:33px;line-height:1.28;font-weight:700;letter-spacing:.2px;margin:0 0 18px;color:#f3f6fc;
}
.login-screen .pitch .lead{font-size:15px;line-height:1.7;color:var(--on-dark-soft);margin:0 0 30px;}

.login-screen .features{list-style:none;margin:0;padding:0;display:grid;gap:14px;}
.login-screen .features li{display:flex;align-items:flex-start;gap:12px;font-size:14px;line-height:1.55;color:#cdd6e6;}
.login-screen .features .dot{
  width:6px;height:6px;margin-top:7px;flex:none;transform:rotate(45deg);
  background:var(--brand-bright);border-radius:1px;box-shadow:0 0 10px rgba(106,160,255,.8);
}

.login-screen .panel-foot{
  display:flex;align-items:center;justify-content:space-between;
  font-family:var(--lp-mono);font-size:11.5px;color:var(--on-dark-faint);letter-spacing:.04em;
  animation:lpRise .6s cubic-bezier(.2,.7,.3,1) .24s both;
}
.login-screen .status{display:inline-flex;align-items:center;gap:7px;}
.login-screen .status .live{position:relative;width:7px;height:7px;border-radius:50%;background:#34d399;}
.login-screen .status .live::after{
  content:"";position:absolute;inset:0;border-radius:50%;
  box-shadow:0 0 0 0 rgba(52,211,153,.45);animation:lpPing 2.6s ease-out infinite;
}

/* 右:表单 */
.login-screen .form-wrap{flex:1 1 54%;display:flex;align-items:center;justify-content:center;padding:48px;}
.login-screen .form{width:100%;max-width:384px;}
.login-screen .form > *{animation:lpRise .55s cubic-bezier(.2,.7,.3,1) both;}
.login-screen .form > *:nth-child(2){animation-delay:.05s;}
.login-screen .form > *:nth-child(3){animation-delay:.10s;}
.login-screen .form > *:nth-child(4){animation-delay:.15s;}
.login-screen .form > *:nth-child(5){animation-delay:.20s;}
.login-screen .form > *:nth-child(6){animation-delay:.25s;}
.login-screen .form > *:nth-child(7){animation-delay:.30s;}

@keyframes lpRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes lpPing{0%{box-shadow:0 0 0 0 rgba(52,211,153,.45)}70%,100%{box-shadow:0 0 0 8px rgba(52,211,153,0)}}
@keyframes lpSpin{to{transform:rotate(360deg)}}
@keyframes lpSweep{from{left:-60%}to{left:130%}}

.login-screen .form h2{font-size:28px;font-weight:700;letter-spacing:.2px;margin:0 0 8px;}
.login-screen .subtitle{font-size:14px;color:var(--ink-soft);margin:0 0 30px;}

.login-screen .field{margin-bottom:18px;}
.login-screen .field-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;}
.login-screen .field label{font-size:13px;font-weight:600;color:var(--ink);}

.login-screen .control{position:relative;}
.login-screen .input{
  width:100%;height:46px;padding:0 14px;font-size:14.5px;font-family:var(--lp-sans);
  color:var(--ink);background:#fff;border:1px solid var(--line-strong);
  border-radius:var(--radius-field);outline:none;
  transition:border-color .16s ease, box-shadow .16s ease;
}
.login-screen .input::placeholder{color:var(--muted);}
.login-screen .input:hover{border-color:#c2c9d6;}
.login-screen .input:focus{border-color:var(--brand);box-shadow:0 0 0 3.5px rgba(59,111,246,.16);}
.login-screen .control.with-toggle .input,
.login-screen .control.with-check .input{padding-right:46px;}

.login-screen .toggle{
  position:absolute;top:50%;right:6px;transform:translateY(-50%);
  width:34px;height:34px;display:grid;place-items:center;border:0;background:transparent;
  color:var(--muted);cursor:pointer;border-radius:8px;
  transition:color .15s ease, background .15s ease;
}
.login-screen .toggle:hover{color:var(--ink-soft);background:#f1f3f8;}
.login-screen .toggle svg{width:18px;height:18px;}

.login-screen .valid-check{
  position:absolute;right:14px;top:50%;transform:translateY(-50%) scale(.5);
  width:18px;height:18px;color:var(--ok);opacity:0;pointer-events:none;
  transition:opacity .2s ease, transform .25s cubic-bezier(.2,1.3,.4,1);
}
.login-screen .field.is-valid .valid-check{opacity:1;transform:translateY(-50%) scale(1);}

.login-screen .form-error{
  font-family:var(--lp-mono);font-size:11.5px;color:var(--danger);
  margin:-4px 0 14px;letter-spacing:.02em;animation:lpRise .25s ease both;
}

/* 最近登录账号快捷回填(切换账号) */
.login-screen .accounts{margin:-4px 0 16px;}
.login-screen .accounts-label{
  display:block;font-family:var(--lp-mono);font-size:10.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted);margin-bottom:8px;
}
.login-screen .accounts-list{display:flex;flex-wrap:wrap;gap:8px;}
.login-screen .chip{
  display:inline-flex;align-items:center;overflow:hidden;
  border:1px solid var(--line-strong);border-radius:999px;background:#fff;
  transition:border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
.login-screen .chip:hover{border-color:#c2c9d6;background:#fafbfd;}
.login-screen .chip.is-active{border-color:var(--brand);box-shadow:0 0 0 2.5px rgba(59,111,246,.14);}
.login-screen .chip-main{
  border:0;background:transparent;padding:6px 4px 6px 12px;
  font-size:12.5px;color:var(--ink);cursor:pointer;
  max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.login-screen .chip-x{
  border:0;background:transparent;padding:0 10px 0 6px;
  font-size:15px;line-height:1;color:var(--muted);cursor:pointer;align-self:stretch;
}
.login-screen .chip-x:hover{color:var(--danger);}

.login-screen .btn{
  width:100%;height:48px;font-family:var(--lp-sans);font-size:15px;font-weight:600;
  border-radius:var(--radius-btn);cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:10px;
  transition:transform .12s ease, box-shadow .18s ease, background .18s ease, border-color .15s ease;
}
.login-screen .btn:active{transform:translateY(1px);}
.login-screen .btn:focus-visible{outline:2px solid var(--brand);outline-offset:2px;}

.login-screen .btn-primary{
  position:relative;overflow:hidden;margin-top:4px;
  color:#fff;background:var(--btn);border:1px solid var(--btn);
  box-shadow:0 12px 26px -14px rgba(11,18,32,.7);
}
.login-screen .btn-primary::after{
  content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;
  background:linear-gradient(100deg, transparent, rgba(255,255,255,.20), transparent);
  transform:skewX(-18deg);
}
.login-screen .btn-primary:hover{background:var(--btn-hover);box-shadow:0 16px 30px -14px rgba(11,18,32,.65);}
.login-screen .btn-primary:hover::after{animation:lpSweep .9s ease;}
.login-screen .btn-primary[disabled]{opacity:.62;cursor:default;transform:none;}

.login-screen .divider{display:flex;align-items:center;gap:14px;margin:22px 0;color:var(--muted);font-size:12.5px;}
.login-screen .divider::before,.login-screen .divider::after{content:"";flex:1;height:1px;background:var(--line);}

.login-screen .btn-google{color:var(--ink);background:#fff;border:1px solid var(--line-strong);}
.login-screen .btn-google:hover{border-color:#c2c9d6;background:#fafbfd;}
.login-screen .btn-google svg{width:18px;height:18px;transition:transform .2s ease;}
.login-screen .btn-google:hover svg{transform:scale(1.08);}

@media (max-width:880px){
  .login-screen .auth{flex-direction:column;}
  .login-screen .panel{flex:none;padding:34px 26px 30px;justify-content:flex-start;gap:26px;}
  .login-screen .pitch .lead,.login-screen .features,.login-screen .panel-foot{display:none;}
  .login-screen .pitch h1{font-size:25px;margin-bottom:0;}
  .login-screen .eyebrow{margin-bottom:14px;}
  .login-screen .form-wrap{padding:34px 26px 48px;}
  .login-screen .form{max-width:420px;margin:0 auto;}
}
@media (max-width:420px){
  .login-screen .panel{padding:28px 20px 26px;}
  .login-screen .form-wrap{padding:28px 20px 40px;}
  .login-screen .form h2{font-size:25px;}
}
@media (prefers-reduced-motion:reduce){
  .login-screen .form > *,
  .login-screen .brand,
  .login-screen .pitch,
  .login-screen .panel-foot{animation:none !important;}
  .login-screen .mark svg{animation:none;}
  .login-screen .status .live::after{animation:none;}
  .login-screen .btn-primary:hover::after{animation:none;}
}
`;

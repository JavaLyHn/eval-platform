#!/usr/bin/env node
/**
 * agentcli-bridge — HTTP+SSE shim in front of the agentcli gateway's
 * WebSocket streaming session API.
 *
 * Endpoints:
 *   GET  /health     -> { status, agent }
 *   POST /v1/chat    -> SSE stream of { delta } chunks, then { done, durationMs }
 *   GET  /v1/skills  -> { agent, version, generatedAt, skills: AgentSkill[] }
 *                       Scans agentcli skill tree by default:
 *                         ~/.agentcli/workspace/skills/<x>/SKILL.md      (自定义)
 *                         ~/.agentcli/plugin-skills/<x>/SKILL.md         (插件)
 *                         /opt/homebrew/lib/node_modules/agentcli/skills/<x>/SKILL.md (系统)
 *                       Optional override: SKILLS_FILE points at a JSON file
 *                       whose contents replace the scanned list verbatim.
 *
 * Wire protocol against the gateway:
 *   - WebSocket to ws://127.0.0.1:18789 with Origin header
 *   - `connect`  with auth.token
 *   - `sessions.messages.subscribe { key }`
 *   - `sessions.send { key, message }`
 *   - Stream `chat` events with state=delta, then state=final
 *
 * Each HTTP request opens its own WS connection — simple and isolates failures.
 *
 * Env:
 *   BRIDGE_PORT       (default 18790)
 *   BRIDGE_TOKEN      (required)
 *   GATEWAY_URL       (default ws://127.0.0.1:18789)
 *   GATEWAY_TOKEN     (gateway token; defaults to reading from ~/.agentcli/agentcli.json)
 *   AGENTCLI_AGENT    (default main)
 *   ALLOW_ORIGIN      (default *)
 *   SKILLS_FILE       (default ./skills.json — JSON file listing agent skills)
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("/opt/homebrew/lib/node_modules/agentcli/node_modules/ws");

const PORT = parseInt(process.env.BRIDGE_PORT ?? "18790", 10);
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;
const GATEWAY_URL = process.env.GATEWAY_URL ?? "ws://127.0.0.1:18789";
const DEFAULT_AGENT = process.env.AGENTCLI_AGENT ?? "main";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? "*";
const VERSION = "0.4.0";

// Optional manual-override JSON file. If present, its contents are returned
// verbatim and the agentcli scan is skipped. Useful for staging / testing.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_FILE = process.env.SKILLS_FILE
  ? resolve(process.env.SKILLS_FILE)
  : resolve(__dirname, "skills.json");

// Where agentcli stores SKILL.md files. Order = priority for category label
// when the same skill id appears in multiple paths.
const SKILL_SOURCES = [
  {
    label: "自定义",
    base: join(homedir(), ".agentcli", "workspace", "skills"),
    depth: 4,
  },
  {
    label: "插件",
    base: join(homedir(), ".agentcli", "plugin-skills"),
    depth: 3,
  },
  {
    label: "系统",
    base: "/opt/homebrew/lib/node_modules/agentcli/skills",
    depth: 3,
  },
];

/**
 * Walk a directory looking for SKILL.md, capped at maxDepth. Follows
 * symlinks because agentcli stages plugin skills as symlinks under
 * ~/.agentcli/plugin-skills/<name> -> ...node_modules/.../skills/<name>.
 */
function* walkSkillFiles(dir, depth, maxDepth) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    let isDir = e.isDirectory();
    if (!isDir && e.isSymbolicLink()) {
      // Resolve the symlink target — statSync follows links.
      try {
        isDir = statSync(join(dir, e.name)).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;
    const sub = join(dir, e.name);
    const skillFile = join(sub, "SKILL.md");
    let hasSkill = false;
    try {
      statSync(skillFile);
      hasSkill = true;
    } catch {}
    if (hasSkill) yield skillFile;
    if (depth < maxDepth) yield* walkSkillFiles(sub, depth + 1, maxDepth);
  }
}

/**
 * Pull `name`, `description`, `user-invocable`, and `metadata.agentcli.emoji`
 * out of a SKILL.md's YAML frontmatter. Deliberately minimal — we know the
 * exact shape agentcli uses, so a real YAML lib would be overkill.
 */
function parseFrontmatter(content) {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return {};
  const body = fm[1];
  const out = {};
  const grab = (re) => {
    const m = body.match(re);
    return m ? m[1].trim() : null;
  };

  const name = grab(/^name:\s*"?([^"\n]+?)"?\s*$/m);
  if (name) out.name = name;

  // description: may be wrapped in a long double-quoted string (incl. \n
  // escapes). Match greedily up to the matching closing quote on the line
  // before a top-level key (or the closing ---).
  const dq = body.match(/^description:\s*"((?:[^"\\]|\\.)*)"\s*$/m);
  if (dq) {
    out.description = dq[1].replace(/\\"/g, '"').replace(/\\n/g, " ");
  } else {
    const plain = grab(/^description:\s*([^\n]+)$/m);
    if (plain) out.description = plain;
  }

  const ui = grab(/^user-invocable:\s*(true|false)\s*$/m);
  if (ui != null) out.userInvocable = ui === "true";

  // metadata.agentcli.emoji — accept any indentation level.
  const emoji = grab(/^\s*emoji:\s*"?([^"\n]+?)"?\s*$/m);
  if (emoji) out.emoji = emoji;

  return out;
}

/**
 * Scan agentcli skill dirs and produce a normalized AgentSkillsResult-style
 * payload. Dedupes by id (skill folder basename), preferring the
 * highest-priority source (workspace > plugin-skills > bundled).
 */
function scanAgentCLISkills() {
  const seen = new Map(); // id -> entry
  for (const src of SKILL_SOURCES) {
    for (const file of walkSkillFiles(src.base, 0, src.depth)) {
      const id = basename(dirname(file));
      if (seen.has(id)) continue;
      let fm;
      try {
        const content = readFileSync(file, "utf-8");
        fm = parseFrontmatter(content);
      } catch {
        continue;
      }
      const tags = [];
      if (fm.userInvocable) tags.push("user-invocable");
      seen.set(id, {
        id,
        name: fm.emoji
          ? `${fm.emoji} ${fm.name ?? id}`
          : fm.name ?? id,
        description: fm.description,
        category: src.label,
        tags,
        meta: { path: file },
      });
    }
  }
  return [...seen.values()];
}

// Cache the override file in memory (mtime-invalidated). The agentcli scan
// is fast enough that we don't bother caching it.
let overrideCache = { mtime: 0, body: null };

function loadOverrideFile() {
  try {
    const st = statSync(SKILLS_FILE);
    if (overrideCache.body && overrideCache.mtime === st.mtimeMs) {
      return overrideCache.body;
    }
    const raw = readFileSync(SKILLS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const body = Array.isArray(parsed)
      ? { skills: parsed }
      : {
          agent: parsed.agent,
          version: parsed.version,
          generatedAt: parsed.generatedAt,
          skills: Array.isArray(parsed.skills) ? parsed.skills : [],
        };
    overrideCache = { mtime: st.mtimeMs, body };
    return body;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function loadSkills() {
  // Manual JSON override wins if present.
  const override = loadOverrideFile();
  if (override) return override;
  // Otherwise scan the real agentcli skill tree.
  return { skills: scanAgentCLISkills() };
}

const GATEWAY_TOKEN =
  process.env.GATEWAY_TOKEN ?? readGatewayTokenFromConfig();

if (!BRIDGE_TOKEN) {
  console.error("[bridge] BRIDGE_TOKEN env var is required");
  process.exit(1);
}
if (!GATEWAY_TOKEN) {
  console.error(
    "[bridge] GATEWAY_TOKEN not found in env or ~/.agentcli/agentcli.json",
  );
  process.exit(1);
}

function readGatewayTokenFromConfig() {
  try {
    const cfg = JSON.parse(
      readFileSync(`${homedir()}/.agentcli/agentcli.json`, "utf8"),
    );
    return cfg?.gateway?.auth?.token ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP helpers                                                               */
/* -------------------------------------------------------------------------- */

function applyCors(req, res) {
  const origin = req.headers.origin ?? "*";
  if (
    ALLOW_ORIGIN === "*" ||
    ALLOW_ORIGIN.split(",").map((o) => o.trim()).includes(origin)
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Extract the assistant's running text from `chat.message.content`, which the
 * gateway emits as either a string or an array of {type:"text", text:"..."}.
 */
function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const c of content) {
    if (c && typeof c.text === "string") out += c.text;
  }
  return out;
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("payload too large");
  }
  return body;
}

/* -------------------------------------------------------------------------- */
/* Gateway WS session                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Open a WS to the gateway, complete handshake, and return a client object
 * with: { connId, request(method, params), onEvent(cb), close() }.
 */
function connectGateway() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL, {
      headers: { Origin: "http://127.0.0.1:18789" },
    });

    const pending = new Map();
    const eventHandlers = new Set();
    let nextId = 1;
    let closed = false;
    let connectId = null;
    let connectResolve = null;
    let connectReject = null;

    function send(method, params) {
      if (closed || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("gateway disconnected"));
      }
      const id = `r${nextId++}`;
      ws.send(JSON.stringify({ type: "req", id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        // safety timeout
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`gateway request timed out: ${method}`));
          }
        }, 60_000);
      });
    }

    ws.on("open", () => {
      // Send connect immediately
      connectId = `r${nextId++}`;
      const connectReq = {
        type: "req",
        id: connectId,
        method: "connect",
        params: {
          minProtocol: 4,
          maxProtocol: 4,
          client: {
            id: "agentcli-control-ui",
            version: "qa-bridge-0.2",
            platform: "node",
            mode: "webchat",
            instanceId: randomUUID(),
          },
          role: "operator",
          scopes: ["operator.read", "operator.write", "operator.admin"],
          caps: ["tool-events"],
          auth: { token: GATEWAY_TOKEN },
        },
      };
      ws.send(JSON.stringify(connectReq));
      connectResolve = resolve;
      connectReject = reject;
    });

    ws.on("message", (data) => {
      let json;
      try {
        json = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (json.type === "res") {
        if (json.id === connectId) {
          if (json.ok) {
            connectResolve({
              connId: json.payload?.server?.connId,
              request: send,
              onEvent(cb) {
                eventHandlers.add(cb);
                return () => eventHandlers.delete(cb);
              },
              close() {
                closed = true;
                if (ws.readyState === WebSocket.OPEN) ws.close();
              },
            });
          } else {
            connectReject(
              new Error(
                `gateway connect failed: ${json.error?.message ?? "unknown"}`,
              ),
            );
            ws.close();
          }
          return;
        }
        const handler = pending.get(json.id);
        if (handler) {
          pending.delete(json.id);
          if (json.ok) handler.resolve(json.payload);
          else handler.reject(new Error(json.error?.message ?? "request failed"));
        }
        return;
      }

      if (json.type === "event") {
        // Drop noisy keepalives
        if (json.event === "tick" || json.event === "health") return;
        for (const cb of eventHandlers) {
          try {
            cb(json);
          } catch (e) {
            console.error("[bridge] event handler error:", e);
          }
        }
      }
    });

    ws.on("close", (code, reason) => {
      closed = true;
      const err = new Error(
        `gateway closed (${code}): ${String(reason).slice(0, 120)}`,
      );
      for (const [, h] of pending) h.reject(err);
      pending.clear();
      if (connectReject) connectReject(err);
    });

    ws.on("error", (err) => {
      if (connectReject) connectReject(err);
    });
  });
}

/* -------------------------------------------------------------------------- */
/* HTTP request handlers                                                      */
/* -------------------------------------------------------------------------- */

async function handleChat(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return jsonResponse(res, 400, { error: `invalid body: ${e.message}` });
  }

  const prompt = String(payload.prompt ?? "").trim();
  if (!prompt) return jsonResponse(res, 400, { error: "missing prompt" });
  const agent = String(payload.agent || DEFAULT_AGENT);
  const incomingSessionKey = String(payload.sessionId || "").trim();

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const startedAt = Date.now();
  let aborted = false;
  let gw = null;

  req.on("close", () => {
    aborted = true;
    if (gw) gw.close();
  });

  // Heartbeat for keep-alive (250 ms — felt responsive in earlier tests)
  const heartbeat = setInterval(() => {
    if (aborted) return;
    res.write(": ping\n\n");
  }, 15_000);

  try {
    gw = await connectGateway();
    if (aborted) {
      clearInterval(heartbeat);
      return;
    }
    sse(res, {
      event: "stage",
      stage: "建立 gateway 连接",
      elapsedMs: Date.now() - startedAt,
    });

    // Resolve the session key. If client didn't pass one (new conversation),
    // create a fresh session via gateway and tell the client to remember it.
    let sessionKey = incomingSessionKey;
    if (!sessionKey) {
      const created = await gw.request("sessions.create", {});
      sessionKey = String(created?.key ?? "");
      if (!sessionKey) throw new Error("sessions.create returned empty key");
      sse(res, {
        event: "stage",
        stage: "新建会话",
        elapsedMs: Date.now() - startedAt,
      });
    }

    sse(res, { event: "start", sessionId: sessionKey, agent });

    let finalReceived = false;
    let lastTextLen = 0;

    const unsub = gw.onEvent((ev) => {
      if (aborted) return;
      const e = ev.event;

      // Forward agent lifecycle as a "stage"
      if (e === "agent" && ev.payload?.stream === "lifecycle") {
        const phase = ev.payload?.data?.phase;
        if (phase === "start") {
          sse(res, {
            event: "stage",
            stage: "Claude 推理中",
            elapsedMs: Date.now() - startedAt,
          });
        }
        return;
      }

      // Stream deltas via chat events. We track total emitted length and only
      // emit the tail; this is robust against a final/delta race or providers
      // that send overlapping deltas.
      if (e === "chat" && ev.payload?.sessionKey === sessionKey) {
        const p = ev.payload;
        // Extract running total text from p.message (covers both delta + final)
        const totalText = extractText(p.message?.content);
        if (totalText.length > lastTextLen) {
          sse(res, { delta: totalText.slice(lastTextLen) });
          lastTextLen = totalText.length;
        }
        if (p.state === "final") {
          finalReceived = true;
          sse(res, {
            done: true,
            sessionId: sessionKey,
            durationMs: Date.now() - startedAt,
          });
          res.write("data: [DONE]\n\n");
          res.end();
          unsub();
          gw.close();
          clearInterval(heartbeat);
        }
      }
    });

    // Subscribe BEFORE sending so we catch all events
    await gw.request("sessions.messages.subscribe", { key: sessionKey });
    if (aborted) return;
    sse(res, {
      event: "stage",
      stage: "已订阅会话",
      elapsedMs: Date.now() - startedAt,
    });

    await gw.request("sessions.send", { key: sessionKey, message: prompt });
    if (aborted) return;

    // Wait for final or timeout (safety: 5 min)
    const cap = Date.now() + 5 * 60_000;
    while (!finalReceived && !aborted && Date.now() < cap) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!finalReceived && !aborted) {
      sse(res, { error: "agent.run timed out after 5 minutes" });
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch (e) {
    if (!aborted) {
      sse(res, { error: String(e.message ?? e).slice(0, 400) });
      sse(res, {
        done: true,
        sessionId: sessionKey,
        durationMs: Date.now() - startedAt,
      });
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } finally {
    clearInterval(heartbeat);
    if (gw) gw.close();
  }
}

/* -------------------------------------------------------------------------- */
/* Server                                                                     */
/* -------------------------------------------------------------------------- */

const server = createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health" && req.method === "GET") {
    return jsonResponse(res, 200, {
      status: "ok",
      agent: DEFAULT_AGENT,
      version: VERSION,
      uptimeSec: Math.round(process.uptime()),
      gateway: GATEWAY_URL,
    });
  }

  if (req.url === "/v1/chat" && req.method === "POST") {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${BRIDGE_TOKEN}`) {
      return jsonResponse(res, 401, { error: "unauthorized" });
    }
    return handleChat(req, res);
  }

  if (req.url === "/v1/skills" && req.method === "GET") {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${BRIDGE_TOKEN}`) {
      return jsonResponse(res, 401, { error: "unauthorized" });
    }
    try {
      const body = loadSkills();
      if (!body) {
        // No file present — return an explicit empty envelope so the
        // frontend can render the "no skills declared" state.
        return jsonResponse(res, 200, {
          agent: DEFAULT_AGENT,
          version: VERSION,
          generatedAt: new Date().toISOString(),
          skills: [],
        });
      }
      // Fill in defaults the file may have omitted.
      return jsonResponse(res, 200, {
        agent: body.agent ?? DEFAULT_AGENT,
        version: body.version ?? VERSION,
        generatedAt: body.generatedAt ?? new Date().toISOString(),
        skills: body.skills,
      });
    } catch (e) {
      return jsonResponse(res, 500, {
        error: `skills inventory parse error: ${String(e.message ?? e)}`,
      });
    }
  }

  return jsonResponse(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[bridge] agentcli-bridge ${VERSION} (WS streaming) listening on 0.0.0.0:${PORT} (agent=${DEFAULT_AGENT}, gateway=${GATEWAY_URL})`,
  );
});

process.on("SIGINT", () => {
  console.log("\n[bridge] shutting down");
  server.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

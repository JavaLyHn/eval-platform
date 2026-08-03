# agentcli-bridge

Tiny HTTP+SSE shim sitting in front of the gateway-loopback `agentcli` CLI.

## What it does

```
QA frontend (LAN)
   │  POST /v1/chat  (Bearer token)
   ▼
agentcli-bridge :18790  (this process)
   │  spawn  agentcli agent --json --session-id ...
   ▼
agentcli gateway @ 127.0.0.1:18789
```

Streams the JSON reply back to the browser as SSE deltas so the chat UI feels
incremental even though the upstream CLI is single-shot.

## Run

```sh
BRIDGE_TOKEN=$(openssl rand -hex 24) \
  /opt/homebrew/bin/node /Users/aa00086/agentcli-bridge/agentcli-bridge.mjs
```

Optional env: `BRIDGE_PORT` (default 18790), `AGENTCLI_AGENT` (default `main`),
`AGENTCLI_TIMEOUT` (default 180s), `ALLOW_ORIGIN` (default `*`).

## Health check

```sh
curl http://127.0.0.1:18790/health
# {"status":"ok","agent":"main","version":"0.1.0","uptimeSec":42}
```

## Smoke test (SSE)

```sh
curl -N \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"用一句话介绍你自己","sessionId":""}' \
  http://127.0.0.1:18790/v1/chat
```

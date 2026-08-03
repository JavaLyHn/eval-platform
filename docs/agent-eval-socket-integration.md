# Platform Agent 开放平台 — Socket 对接文档（Agent 能力测评系统）

> 适用对象：第三方 **Agent 能力测评系统**。本文档描述如何通过 Platform 开放平台（server-agent Open API）驱动一个被测 Agent 实例完成对话，并实时采集 Agent 的输出，用于能力评测。
>
> 全部接口实现位于 `apps/server-agent`（REST + Socket.IO Gateway）与 `libs/agent`（鉴权 / 会话 / 推送）。

---

## 0. 总览

测评系统对接分两条通道：

| 通道 | 协议 | 用途 |
|------|------|------|
| **REST Open API** | HTTPS，路由前缀 `/api/open/` | 申请临时 token、创建/续聊会话、拉取已落库消息、中止/删除会话 |
| **Socket.IO** | WebSocket，命名空间 `/open/agent` | 实时订阅某个会话的 Agent 输出流（流式 token、工具调用、完成信号） |

标准对接流程（测评一轮对话）：

```
① POST /api/open/auth/token          → 拿到一次性 WS token（5 分钟内有效，连接即销毁）
② socket.io connect /open/agent      → handshake.auth.token = 上一步 token，建立长连
③ socket.emit("subscribe", {sessionId})  ← sessionId 需先经 ④ 创建
④ POST /api/open/agent/:id/sessions  → 创建会话并发送首条消息，返回 sessionId
⑤ 监听服务端推送：message / tool_use / tool_done / done / error ...
⑥ 收到 done → 本轮回答结束；可拉取 REST 消息历史作为评测样本，或继续 ④ 续聊
```

> ⚠️ ③ 与 ④ 的先后：必须**先有 sessionId 才能 subscribe**。两种顺序都可行：
> - **推荐**：先 ④ 创建会话拿到 `sessionId`，再 ③ subscribe。若 Agent 响应极快，订阅前可能已开始推理——subscribe 时服务端会用 `isSnapshot` 把"正在生成中"的内容补发给你（见 §6.1），不会丢内容。
> - 也可先 subscribe 一个已存在的历史 `sessionId`，再 ④ 用同一 `sessionId` 续聊。

---

## 1. 接入前提

测评系统需向 Platform 平台侧申请两样东西：

1. **API Key**：格式为 `ok_` + 64 位十六进制串（如 `ok_a1b2c3...`）。由平台在 Agent 管理控制台生成并分发，是 B 端（租户）级凭证，归属某个 `userId`。**仅创建时返回一次明文，请妥善保管。**
2. **被测 Agent 实例 ID（`instanceId`）**：要评测的 Agent 实例。可用 `GET /api/open/agent/instances` 列出当前 API Key 名下的全部实例（见 §7）。该实例必须归属于 API Key 对应的 `userId`，否则报 `AGENT_INSTANCE_ACCESS_DENIED`。

另外，测评系统需为每个被测会话自行分配一个 **`operatorId`**（C 端终端用户标识，≤ 128 字符）。可理解为"这一通对话是哪个虚拟用户发起的"。同一会话的 token 申请、创建、订阅必须使用**同一个** `operatorId`（见 §5 的归属校验）。

### 鉴权约定（所有 REST Open API）

| Header | 说明 |
|--------|------|
| `Authorization: Bearer ok_xxx` | API Key，必填 |
| `X-Operator-Id: <operatorId>` | C 端终端用户标识，必填（≤ 128 字符） |

> 实现：`ApiKeyAuthGuard` 对所有 `/api/open/*`（除 `/api/open/webhook/*`）强制校验 API Key；`@OperatorId()` 装饰器强制校验 `X-Operator-Id` 头。

---

## 2. 申请临时 WS Token

Socket 连接**不直接使用 API Key**（推荐），而是先用 API Key 换一个一次性的短时 token，再用它握手。

### 请求

```
POST /api/open/auth/token
Authorization: Bearer ok_a1b2c3...
X-Operator-Id: eval-user-001
```

请求体：**空**。`operatorId` 取自 `X-Operator-Id` 头并被**牢牢绑定**进 token（客户端无法篡改）。

### 响应 `201`

```json
{
  "token": "9f2b...（64 位 hex）",
  "expiresIn": 300
}
```

| 字段 | 含义 |
|------|------|
| `token` | 一次性 WebSocket 鉴权 token |
| `expiresIn` | 有效期秒数，固定 `300`（5 分钟） |

**Token 特性（务必理解）：**
- **一次性**：socket 连接时被原子 `GET+DEL` 消费，消费后立即失效。
- **5 分钟 TTL**：申请后需在 5 分钟内完成连接。
- **绑定 `{userId, operatorId}`**：连接成功后这两个身份注入到 socket 上，后续 subscribe 用它做归属校验。
- 若测评系统需要**多条并发 socket 连接**，每条连接各自申请一个 token。

> 实现：`OpenAuthController.issueWsToken` → `WsTokenService.issue/consume`（Redis，Lua 原子消费）。

---

## 3. 连接 Socket

使用 **socket.io-client v4**（服务端为 NestJS Socket.IO v4，协议须匹配）。

- **URL**：`http(s)://<server-agent-host>:<port>/open/agent`
  - 本地开发端口默认 `3720`，无全局路由前缀。命名空间是 URL 路径里的 `/open/agent`。
- **握手鉴权**：`auth.token` 放上一步申请的临时 token。

```js
import { io } from "socket.io-client";

const socket = io("https://your-host/open/agent", {
  transports: ["websocket"],
  auth: { token: wsToken }, // 来自 POST /api/open/auth/token
});

socket.on("connect", () => console.log("connected", socket.id));
socket.on("connect_error", (e) => console.error("connect_error", e.message));
socket.on("disconnect", (r) => console.warn("disconnected", r));
```

### 兼容方式：API Key 直连（不推荐用于测评）

```js
const socket = io("https://your-host/open/agent", {
  transports: ["websocket"],
  auth: { apiKey: "ok_a1b2c3..." },
});
```

> 区别：API Key 直连只携带 `userId`（B 端），**不带 `operatorId`**。此时 subscribe 不做 operator 级校验（可订阅该租户名下任意会话）。测评系统建议用临时 token 方式，使 operator 维度隔离清晰。

### 连接被拒（服务端 `disconnect(true)`）的原因

- Origin 不在白名单（仅当服务端配置了 `AGENT_ALLOWED_ORIGINS` 且非空时校验）
- 无效 / 过期 / 已被消费的 WS token
- 无效 / 停用 / 过期的 API Key
- 既没传 `token` 也没传 `apiKey`

> 实现：`OpenAgentSessionGateway.handleConnection`。

---

## 4. 创建会话并发送消息

会话通过 **REST** 创建（不是 socket）。同一个端点既能"新建会话"也能"在已有会话上续聊"。

### 请求

```
POST /api/open/agent/{instanceId}/sessions
Authorization: Bearer ok_a1b2c3...
X-Operator-Id: eval-user-001
Content-Type: application/json
```

请求体（`CreateSessionWithMessageDto`）：

```json
{
  "sessionId": null,
  "title": "能力测评-数学推理-001",
  "message": "请计算 (17 × 23) + 19，并给出步骤。",
  "metadata": { "timezone": "Asia/Shanghai" },
  "attachments": [],
  "clientMsgId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 否 | 不传 = 新建会话；传 = 在该会话上续聊 |
| `title` | string(≤255) | 否 | 不传则服务端按 `Session#N` 自动生成 |
| `message` | string(≤32000) | 否* | 用户消息；*有 `attachments` 时可为空，但二者不能同时为空 |
| `metadata` | object | 否 | 消息级元数据，透传给首条 user_message |
| `attachments` | array(≤10) | 否 | 附件，元素见下 |
| `clientMsgId` | string(uuid) | 否 | 客户端生成的 UUID，用于幂等与乐观消息去重（强烈建议每条消息带上，便于测评系统对账） |

附件元素（`MessageAttachmentSchema`）：`{ fileName, fileSize, fileType, url }`，`url` 为对象存储完整 URL。

### 响应 `201`（`CreateSessionWithMessageResult`）

```json
{
  "sessionId": "1934567890123456789",
  "messageId": "1934567890987654321",
  "queued": false,
  "session": {
    "id": "1934567890123456789",
    "title": "能力测评-数学推理-001",
    "operatorId": "eval-user-001",
    "originType": "user",
    "status": "running",
    "errorMessage": null,
    "updateTime": "2026-06-01T10:00:00.000Z",
    "customerExternalId": null
  },
  "clientMsgId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| 字段 | 说明 |
|------|------|
| `sessionId` | 会话 ID（用于 subscribe）。**测评系统拿到后即可 ③ 订阅** |
| `messageId` | 本条用户消息 ID |
| `queued` | `true`=会话忙、消息入 pending 队列稍后执行；`false`=立即开始推理 |
| `session` | 仅**新建**会话时返回完整会话信息；续聊已有会话时**不返回** |
| `clientMsgId` | 原样回传 |

> 续聊：同一会话上再发一条消息时，带上首次返回的 `sessionId`。若上一轮仍在 `running`，本条会 `queued=true` 排队。

---

## 5. 订阅会话

连上 socket 后，对目标会话发起订阅：

```js
socket.emit("subscribe", { sessionId: "1934567890123456789" });
```

服务端会校验：
1. **会话归属**：`session.userId` 必须等于连接身份的 `userId`，否则推 `error {sessionId, message:"Forbidden"}`。
2. **operator 归属**（仅 WS token 连接、且 `session.operatorId !== ""` 时）：`session.operatorId` 必须等于 token 绑定的 `operatorId`，否则 `Forbidden`。
   - 例外：`session.operatorId === ""` 是"组织共享"标记，跳过该校验。

> ⚠️ **测评系统最常见的坑**：申请 token 时的 `X-Operator-Id` 与创建会话时的 `X-Operator-Id` 必须**一致**，否则 subscribe 会被 `Forbidden`。建议在测评系统里把 `operatorId` 作为一通对话的会话级常量贯穿始终。

### 订阅成功后的初始推送

- 若订阅时该会话**正在生成**（有 in-flight 消息）：立即收到一条 `message` 事件，`isSnapshot:true`，`content` 为**截至当前的累计文本**（用于补齐 subscribe 之前已经吐出的内容）。
- 否则若会话当前**不在 running**：立即收到一条 `done {sessionId}`，表示"当前没有进行中的推理"。

### 取消订阅

```js
socket.emit("unsubscribe", { sessionId });
```

断开连接（`disconnect`）时服务端会自动清理该 socket 的全部订阅，无需手动 unsubscribe。

---

## 6. 服务端推送事件（测评采集核心）

订阅成功后，服务端通过 **`client.emit(eventName, payload)`** 单播以下事件。所有事件均**全链路脱敏**。

| 事件名 | Payload | 含义 |
|--------|---------|------|
| `message` | `{ sessionId, messageId, role, content, isChunk, isSnapshot? }` | Agent / 用户消息（流式或完整） |
| `tool_use` | `{ sessionId, toolCallId, toolName, toolInput? }` | 工具被调用 |
| `tool_done` | `{ sessionId, toolCallId, toolName, isError, output? }` | 工具执行完成 |
| `tool_cancel` | `{ sessionId, toolCallId }` | 工具调用被取消（孤儿补偿） |
| `done` | `{ sessionId, interrupted? }` | 本轮推理结束 |
| `aborted` | `{ sessionId }` | 会话被中止 |
| `error` | `{ sessionId, message }` | 推理出错（message 固定脱敏为 `"An error occurred. Please try again."`） |
| `title_updated` | `{ sessionId, title }` | 会话标题更新 |

### 6.1 `message` 事件的文本重建（重要）

`content` 是 `string`，`role` 为 `"user"` 或 `"assistant"`。关键在 `isChunk`：

| `isChunk` | `content` 语义 |
|-----------|----------------|
| `true` | **增量片段（delta）**——仅本 chunk 新增的文本，需要客户端**逐段拼接** |
| `false` | **完整文本**——一段完整消息的最终内容（工具调用前的文本段、或本轮最终回答） |
| `isSnapshot:true` | 订阅瞬间补发的**累计快照**（截至当前已生成的全部文本），只在 subscribe 时出现一次 |

因此，从 socket 流重建 Agent 回答有两种等价做法：
- **简单可靠**：忽略 `isChunk:true`，只收集 `isChunk:false` 的完整消息（这些就是定稿文本）。
- **低延迟**：拼接 `isChunk:true` 的 delta 做实时展示，并以 `isChunk:false` 校正定稿。

> 实现细节：流式途中每个 delta 走 `isChunk:true`；一段文本收尾（含进入工具调用前、本轮结束）走 `isChunk:false`；subscribe 时的 in-flight 快照走 `isSnapshot:true`（内容为累计值）。

### 6.2 工具事件的脱敏白名单

仅以下三个工具会携带 `toolInput` / `output`，其余工具一律隐去参数与输出（只暴露 `toolName` / `isError`）：

```
present_options, panel_show, preview_file
```

对测评系统的影响：**无法从开放平台看到任意工具的原始入参/出参**（仅工具名与成败）。若测评维度需要工具调用细节，需与平台侧另行约定。

### 6.3 `done.interrupted` 的判定

- `done` 表示一轮推理结束。
- `done.interrupted === true` 表示 Agent **暂停等待用户操作**（例如调了 `present_options` 让用户选择），**并非真正完成**。测评系统应把它判定为"等待输入"状态，而不是"任务完成"，必要时投喂下一条消息继续。

---

## 7. REST 读取接口（事后采样，强烈推荐）

由于 socket 的流式 chunk 是 delta、且实时流可能因网络抖动丢段，**测评系统采集 Agent 输出的首选方式**是：监听 socket 的 `done` 作为"本轮结束"信号，然后调用下面的 REST 接口拉取**已落库、结构化、同样脱敏**的完整消息历史作为评测样本。socket 流则用于实时进度展示或低延迟评测场景。

### 7.1 拉取会话消息历史

```
GET /api/open/agent/sessions/{sessionId}/messages?size=50&before=<messageId>
Authorization: Bearer ok_xxx
X-Operator-Id: eval-user-001
```

- 返回 checkpointer 中**已完成**的消息（不含排队中的用户消息），按时间升序，游标分页。
- `size` 默认 20，最大 100；`before` 为游标（返回该消息 ID 之前/更早的消息）。
- 响应：`{ total, hasMore, data: OpenSessionHistoryItem[], sessionStatus }`。
- 工具脱敏规则与 socket 一致：白名单工具保留 `toolInput`/`output`，其余移除；`role:"tool"` 的 `content` 置空。

`OpenSessionHistoryItem` 主要字段：`{ id, role, content, createTime, status, toolCalls?[], toolCallId?, toolName?, isError? }`。

### 7.2 其他读/控制接口

| 方法 & 路径 | 说明 |
|------|------|
| `GET /api/open/agent/instances` | 列出当前 API Key 名下 Agent 实例（分页：`page/size/sort/keyword/groupId`） |
| `GET /api/open/agent/instances/{id}` | 实例详情（精简版：`id/name/description/groupId/chatModel`） |
| `GET /api/open/agent/{instanceId}/sessions` | 列出实例下会话（分页，按更新时间倒序；`originTypes` 过滤，默认排除 `channel`） |
| `GET /api/open/agent/sessions/{sessionId}` | 会话基本信息（`{ instanceId }`） |
| `GET /api/open/agent/sessions/{sessionId}/pending-messages` | 排队中的用户消息 |
| `POST /api/open/agent/{instanceId}/sessions/{sessionId}/abort` | 中止推理，body 可选 `{ clearPending?: boolean }`，返回 `204` |
| `DELETE /api/open/agent/{instanceId}/sessions/{sessionId}` | 删除会话及关联数据（运行中返回 `409`），`204` |

会话 `status` 枚举：`idle`（空闲）/ `running`（执行中）/ `error`（出错）/ `interrupted`（等待用户选择）。

---

## 8. 错误码

REST 鉴权相关错误（HTTP 层由 `AppError` 抛出，附带 `code`）：

| code | 含义 |
|------|------|
| 3133 | `API_KEY_MISSING` — 缺 `Authorization` 头 |
| 3134 | `API_KEY_INVALID_FORMAT` — 不是 `Bearer ` 开头 |
| 3135 | `API_KEY_INVALID` — 无匹配的有效 Key |
| 3136 | `API_KEY_DISABLED` — Key 被停用 |
| 3137 | `API_KEY_EXPIRED` — Key 已过期 |
| 3161 | `MISSING_OPERATOR_ID_HEADER` — 缺 `X-Operator-Id` |
| 3162 | `OPERATOR_ID_TOO_LONG` — `X-Operator-Id` 超 128 字符 |

Socket 层：连接鉴权失败 → 直接 `disconnect`（无 ack）；subscribe 鉴权失败 → 推 `error {sessionId, message:"Unauthorized"|"Forbidden"}`，不断连。

---

## 9. 端到端示例（Node.js）

```js
import { io } from "socket.io-client";

const BASE = "https://your-host";           // server-agent
const API_KEY = "ok_a1b2c3...";
const OPERATOR_ID = "eval-user-001";          // 一通对话的会话级常量
const INSTANCE_ID = "1934500000000000000";    // 被测 Agent 实例

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "X-Operator-Id": OPERATOR_ID,
  "Content-Type": "application/json",
};

// ① 申请一次性 WS token
const { token } = await fetch(`${BASE}/api/open/auth/token`, {
  method: "POST",
  headers,
}).then((r) => r.json());

// ② 连接 socket
const socket = io(`${BASE}/open/agent`, {
  transports: ["websocket"],
  auth: { token },
});
await new Promise((res, rej) => {
  socket.on("connect", res);
  socket.on("connect_error", rej);
});

// ④ 创建会话并发送首条消息
const created = await fetch(`${BASE}/api/open/agent/${INSTANCE_ID}/sessions`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    message: "请计算 (17 × 23) + 19，并给出步骤。",
    clientMsgId: crypto.randomUUID(),
  }),
}).then((r) => r.json());

const sessionId = created.sessionId;

// ⑤ 采集本轮输出，done 即结束
const finalChunks = [];
await new Promise((resolve, reject) => {
  socket.on("message", (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.role === "assistant" && m.isChunk === false) finalChunks.push(m.content);
  });
  socket.on("tool_use", (t) => console.log("tool_use", t.toolName));
  socket.on("done", (d) => {
    if (d.sessionId !== sessionId) return;
    if (d.interrupted) console.log("Agent 等待用户操作，需继续投喂");
    resolve();
  });
  socket.on("error", (e) => reject(new Error(e.message)));

  // ③ 订阅（创建后订阅；若已开始生成，会收到 isSnapshot 补发）
  socket.emit("subscribe", { sessionId });
});

const answerFromStream = finalChunks.join("\n");

// 推荐：done 后再从 REST 拉取已落库的完整历史作为评测样本
const history = await fetch(
  `${BASE}/api/open/agent/sessions/${sessionId}/messages?size=100`,
  { headers },
).then((r) => r.json());

console.log("stream answer:", answerFromStream);
console.log("authoritative history:", history.data);

socket.emit("unsubscribe", { sessionId });
socket.disconnect();
```

---

## 10. 对接清单（Checklist）

- [ ] 拿到 API Key（`ok_...`）与被测 `instanceId`
- [ ] 为每通对话固定一个 `operatorId`，贯穿 token 申请 / 创建 / 订阅（三处一致）
- [ ] socket.io-client **v4**，连 `/open/agent` 命名空间，`auth.token` 用临时 token
- [ ] token 5 分钟内用掉、一次性；多连接各自申请
- [ ] 创建会话拿 `sessionId` → subscribe；处理 `isSnapshot` 补发
- [ ] 文本重建以 `isChunk:false` 为准；`done.interrupted` 视为"等待输入"
- [ ] 工具入参/出参仅白名单可见（`present_options`/`panel_show`/`preview_file`）
- [ ] 评测样本优先用 REST `GET .../messages` 的定稿历史，socket 流作实时辅助

---

### 关键源码索引（便于平台侧排障）

- 临时 token：`apps/server-agent/src/controller/open/open-auth.controller.ts`、`libs/agent/src/account/service/ws-token.service.ts`
- Socket Gateway：`apps/server-agent/src/gateway/open-agent-session.gateway.ts`
- 创建/会话：`apps/server-agent/src/controller/open/open-agent-session.controller.ts`
- 消息历史：`apps/server-agent/src/controller/open/open-agent-message.controller.ts`
- 鉴权 Guard / 装饰器：`libs/agent/src/account/guards/{api-key-auth.guard,operator-id.decorator,api-key-user.decorator}.ts`
- 推送事件来源：`libs/agent/src/service/agent-run.service.ts`、`agent-gateway.service.ts`
</content>
</invoke>

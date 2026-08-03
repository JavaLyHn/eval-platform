<p align="center">
  <h1 align="center">🧪 Eval Platform</h1>
  <p align="center">
    <strong>AI Agent 评测 / 上线决策平台</strong>
  </p>
  <p align="center">
    <a href="https://github.com/JavaLyHn/eval-platform">
      <img src="https://img.shields.io/badge/GitHub-eval--platform-blue?logo=github" alt="GitHub">
    </a>
    <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" alt="Vite 6">
    <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18">
    <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5">
    <img src="https://img.shields.io/badge/Tailwind-3-38BDF8?logo=tailwindcss&logoColor=white" alt="Tailwind 3">
    <img src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" alt="FastAPI">
    <img src="https://img.shields.io/badge/Postgres-17-336791?logo=postgresql&logoColor=white" alt="Postgres 17">
  </p>
</p>

一个面向 **AI Agent / AI 员工**的端到端评测平台:给 Agent 出题、让它答、多裁判打分、看板汇总,
最后产出一份「能不能上线 / 放量」的决策报告。仓库自带一组**虚构 demo 员工**(营销 Aria / 客服 Sam /
数据实习生 Dex),用来演示平台如何为不同岗位的 Agent 定义职责、专属指标与 Pass/Fail 判据 —— 你可以
自由编辑成自己的 Agent 画像。

两条能力线:
- **评测**:「挑题 → 答题 → 评分 → 看板 → 出报告」 一条闭环已经跑通；本地优先 + 自动持久化到 Postgres,断网可用、联网自动 flush。
- **Skill 评测 / 优化**:接入 [microsoft/SkillOpt](https://github.com/microsoft/SkillOpt),把一份 `skill.md` 当可训练状态,跑「基线 → Rollout/Reflect/Gate → 注入经验 → 留出集前后对比」循环,产出优化后的 `best_skill.md`,结果用业务可读的仪表盘呈现(见 [模块 K](#k-skill-评测skillopt-接入))。

---

## 解决什么问题

「清单上写的能力 ✅」和「实测表现」之间往往有落差 —— AI Agent 尤其如此(非确定性、边界失守、红线越界)。
本平台把评测口径**固化成代码 + 数据库 + 流程**,让「Agent 到底能不能用」变成可复现的数据而非口头印象:

- **统一标准**：所有评测能力锚定一份评测标准（通用项 + 强约束项 + 角色专属项，Pass/Fail 双向判定）
- **被测 / 判官分离**：Agent 走 Bridge 受测，LLM 直连 API 出题 + 评分；**类型 / 表 / UI 三层全部隔离**
- **多 Judge 校准**：同一道题可指定 N 个 LLM 同时打分，取多数判 + 平均分 + 一致率（agreementRate）
- **本地优先 + 自动同步**：每一步操作经 Outbox 队列自动落库，不再需要手动「保存」「同步」按钮

---

## 路由结构

```
/                  评测中心（聊天 + 当前任务 + 打分）
/library           题库 CRUD + 看板（view 切换）
/library/:id       单题详情全屏页
/reports           评测报告列表（搜索 / 排序 / 删除）
/reports/:id       报告 HTML 预览 + Markdown 导出
/skillopt          Skill 评测（SkillOpt 优化闭环 + 结果仪表盘）
```

左导航：**评测中心 / 题库 / 评测报告 / 标准员工 / Skill 评测**

---

## 已实现功能模块

### A. 后端持久化层（FastAPI + Postgres 17）

| 表 | 说明 |
|---|---|
| `agent_profiles` | 被测 Agent profile（kind = agent） |
| `llm_profiles` | 出题 / 评分用的裸 LLM（kind = llm） |
| `questions` | 题库 |
| `conversations` + `messages` | 多会话聊天记录 |
| `evaluations` | 评测记录（含多 judge 校准快照） |
| `evaluation_reports` | 手动生成的只读报告快照 |
| `settings` | KV 偏好 |

- **混合 schema**：典型字段做强类型列 + 索引，复杂结构落 JSONB `data` 列，前后端零拷贝
- **时区 Asia/Shanghai 4 层强制**：cluster GUC + docker env + asyncpg session + Python 序列化 (`astimezone(ZoneInfo)`)
- **启动自动迁移**：误存在 `agent_profiles` 里的 LLM 类型行自动幂等搬到 `llm_profiles`

### B. 本地优先 + 自动同步（前端）

```
UI 改动 → Zustand store → diff → Outbox 队列
            ↓ 持久化 + 指数退避 1s/2s/.../60s ↓
        POST /v1/<table>/upsert → Postgres
            ↑ boot hydration（每次启动拉全表）
```

- **Outbox**：同 (table, recordId) 操作自动 coalesce；8 次失败入死信；UI 顶部 banner 显示死信 + 重试 / 清空
- **DELETE-404 幂等**：删本地不存在的 server 记录视为成功
- **离线可用**，恢复后队列自动 flush
- **selection 状态按 conversation 分桶**，切会话不互相污染

### C. Agent / LLM Provider 体系

4 个内置 Provider：

| ID | Kind | 用途 |
|---|---|---|
| `mock` | agent | 离线演示 |
| `agentcli-bridge` | agent | 通过 HTTP+SSE Bridge 调本地 agentcli |
| `openai-compat` | llm | OpenAI Chat Completions 兼容端点（DeepSeek / Moonshot / Qwen / GLM / Groq / Together / Ollama …） |
| `anthropic` | llm | Anthropic `/v1/messages` SSE 直连 |

每种 Profile 5 字段：Name / Provider / Base URL / API Key / Model。输入空格自动去除。

### D. 题库管理（`/library`）

纯 CRUD + 分类 + 批量动作。

- **完整字段**：标题 / 多分类 / 难度 / 严重度（P0-P2）/ 意图（typical / boundary / anomaly）/ Pass 形态 / Fail 形态 / 参考答案 / 多步 `subPrompts` / 变量 `{{var}}` 占位
- **目标员工**：6 标准员工 + 「全体员工」（适用所有 agent）+ 未指定
- **批量分配员工**：多选 → 一键改 `targetEmployeeId`
- **多选 + 批量删除**
- **拖拽排序**：始终启用，无需切换；首次拖放自动锁定 `sort=manual`
- **分组**：员工 / P 级 / 意图 / 难度
- **分页**：默认 50/页，支持「全部」
- **筛选**：员工 / 严重度 / 意图 + 全文搜索
- **导入 / 导出**：JSON / CSV
- **详情视图**：右侧抽屉 + `/library/:id` 全屏页，Markdown 渲染 prompt / Pass / Fail / 子提示

### E. 出题（人工 / AI 双通道）

「出题 ▼」popover 两阶段：

**人工出题** → 打开 `QuestionFormDialog`，与「编辑题目」用**同一套表单**，字段集完全一致。

**AI 出题**（按 Skill）：
1. 列 agentcli `/v1/skills` 全部 skill，可搜索
2. 选 LLM 模型 + 各档难度的题目数 + 出题侧重
3. LLM 流式生成，实时显示原文
4. **4 层容错解析**：`JSON.parse` → 去 fence → brace-balanced 块提取 → 单题级 recovery（一道坏 JSON 不拖整批）
5. 富预览卡片可编辑全部字段：标题 / prompt / 目标员工 / 分类 / 难度 / 严重度 / 意图 / Pass / Fail / 参考答案
6. 勾选 → 入库

### F. 答题（评测中心 `/`）

- **多会话**（Claude.ai 风格左栏：新建 / 重命名 / 删除 / ⌘K 搜索）
- **后台流式不打断**：切会话 / 切题不会 abort 别的会话正在跑的流
- **多步串发**：subPrompts 按顺序自动发送
- **变量替换**：`{{var}}` 占位实时填表
- **停止生成 / 中断恢复**：中断的回答自动回退为「未测」，不污染评测数据
- **空态智能**：没选任何题目时右侧不渲染，只留左侧 chat
- **BulkQueueBar 队列条**：
  - 多选展开后每题可独立 ▶ 运行 / ✕ 移除 / 批量全跑
  - 跑队列时显示进度 / 当前题 / 失败计数
  - 跑完显示总结 + 每题快速跳到打分
- **「全体员工」题自动 fan-out** 到所有 agent profile

### G. 评分（Pass/Fail + LLM Judge + R2 校准）

- **3 项评分维度**：准确性（0.4）/ 专业性（0.35）/ 语气（0.25），全平台统一
- **双向判定**：严格 `passed / failed`
- **两种模式**：
  - 人工：滑动条 + 高亮文段标注 + 评语
  - LLM-as-Judge：JudgeBar 同时选 N 个 LLM；预填表单后人工 review；3 层容错解析（JSON.parse → 去 fence → 正则按字段抽）
- **R2 多裁判校准**：N 个 judge 同打一题 → 取多数判 + 平均分 + `agreementRate`；每个 judge 的原始 raw 输出 snapshot 落 `Evaluation.calibrationSnapshots`，可历史回溯
- **历史记录** 按当前会话 scope，🤖 LLM / 🧑 人工 标识区分
- **抽审逐条复核**：发版门抽样 → 弹窗内逐条人工复核（LLM 判据「为何这么判」+ 题目附件 + 逐维度打分 + 双向抓漏判/错杀）


### H. 数据看板

- **顶部员工筛选 chips**：sticky，按员工切 scope，下方所有指标实时跟随
- **4 张 KPI 卡**：通过率 / 平均分 / 测试进度 / 失败数
- **2 张 Donut**：测试状态分布、题目难度分布
- **趋势图**：按时间累计通过率（手撸 SVG）
- **各类别表现**：按 category 分组的通过率条形图 + 均分
- **按 Agent 版本对比**：同组题不同 Agent 谁强谁弱
- **失败题专辑**：按失败次数排序 + 最近评语 sample
- **员工对比网格**：6 张小卡片永远显示全员全景，点卡片切到该员工视图
- **明细导出**：当前 scope 下评测 JSON / CSV，按 scope 命名


### I. 评测报告（手动生成 + 后端持久化）

完整闭环模块。`/reports` 现并列**两类报告**:**Agent 评测报告**(本节,题数/通过率/均分,后端持久化)+ **Skill 评测报告**(来自「Skill 评测」跑完手动保存,留出 soft 基线→最优 / pass^k + **发版结论**,见模块 K;**Postgres 持久化 + 跨设备 sync**)。列表带「Agent / Skill」类型标签 + 类型筛选,各自路由到 `/reports/:id` 或 `/skill-reports/:id`。

**生成流程**：
1. 数据看板「📄 生成报告」按钮
2. 对话框：标题（默认精确到秒，自动不重名）+ 被测 Agent + 范围（默认当前 empFilter）+ 实时预览将冻结的题目数
3. 提交 → 按 agent 过滤评测，每题取最新一次 → 冻结快照 → 入库 + 推后端 → 跳预览

**冻结的快照字段**：
- 被测 Agent id + 名字 snapshot（agent 改名不影响历史）
- 题目 id + 标题 + prompt 全部 snapshot
- Agent 回答完整内容
- 评分 verdict + autoScore + 3 维度分 + 评语 + 提交时间

**预览页 `/reports/:id`**：
- HTML 渲染：标题 / Agent / 题数 / 通过失败计数 / 均分 / 时间
- 每题完整展开：Prompt（Markdown）+ 回答（Markdown）+ 3 维度评分网格 + 评语
- 「📥 导出 Markdown」按钮：用户驱动下载 `report-{title}-{date}.md`，绝不自动导出
- 「🗑 删除」（确认对话框）

**列表页 `/reports`**：
- 全部历史报告，搜索（标题 / Agent）+ Agent 筛选
- 5 字段排序：标题 / 题数 / 通过率 / 均分 / 生成时间
- 表格行带通过率进度条
- 行级删除 + 空状态引导
- **被测 Agent 头像**:详情页(`/reports/:id`)+ 列表页(`/reports`)均按 `agentProfileId` 反查标准员工显示头像(认不出回退 👤)

**后端**：
- 新表 `evaluation_reports`（typed 列 + JSONB blob）
- 完整 CRUD `/v1/reports`
- 一次性 migrate 支持 `reports[]` key
- 走 outbox 自动同步


### J. 成本核算

每条 agent 回复结尾元信息行新增**美元成本估算**：
```
42.40s · 1108 tokens · $0.037 · claude-opus-4-7
                       ↑ 新增
```

- 内置 **30+ 模型公开定价表**：Anthropic / OpenAI / DeepSeek / Moonshot / Qwen / 智谱 GLM / Gemini / Llama / Mistral
- 因只有总 tokens，按 **70% input / 30% output 混合估算**
- lowercase substring 匹配 + 长前缀优先（`claude-opus-4-7` 优先于 `claude`）
- 抓不到的型号成本不显示，不留 placeholder
- 自适应位数：`<$0.0001` / 4 位 / 3 位 / 2 位
- Tooltip 标注「仅供参考，非实际账单」

### K. Skill 评测（SkillOpt 接入）

把 [microsoft/SkillOpt](https://github.com/microsoft/SkillOpt) 完整接进平台,在 `/skillopt` 页一键跑「skill 优化」闭环。

**被测对象 = 「skill + 模型」组合**(黄金准则:评 agent = 评 harness+model 一起)。Platform 仅有只读 skill 接口、无写 / 绑定接口,所以这里用**自托管 target**:把 skill 当 system prompt 喂给你选的 LLM 跑,真 Platform 员工的 skill 写回仍 park,等其放开写接口。


**完整循环**(SkillOpt,后端起子进程驱动):

```
基线评估(种子 skill 在 val 选择集打分)
  → 训练步 × N:1/6 Rollout(skill 当 system,跑 train 题)→ 2/6 Reflect(优化器读轨迹提编辑)
                → Merge/Update → 6/6 Gate(候选在选择集重评,提分才收 → accept/reject/skip)
  → Epoch 边界(≥2 epoch):Slow Update 注入「Strategic Guidance」+ Meta Skill
  → 收尾:产 best_skill.md;在【留出 test 集】上跑 种子 vs 最优 → 真·前后对比
```

**确定性打分 cascade**(`server` 侧移植自 `src/lib/ground-truth-check.ts`,口径对齐):无响应→0 │ **no-leak 红线**(一票否决,带**回声豁免**:复述用户 prompt 自带的词不算泄漏)│ 预期拦截 │ acceptAny │ standard(意图 / 是否需澄清 / 槽位 / 语言 / 确定性检查,子项带标签 → 失败原因具体到「意图判别不符」)。hard(0/1)+ soft([0,1])。

**结果仪表盘**(业务可读,非工程日志):
- ① 效果对比:种子 vs 最优,通过率 hard% + 质量分 soft,带涨跌;留出集接 **pass^k**(每题跑 K 次、K 次全过才算过 = 保下限),与均值并列展示
- ② 优化过程时间线:每步 接受 / 拒绝 / 无改动,可点开
- ③ 学到了什么:高亮 Slow-Update 注入的经验 + 折叠「种子 → 最优」行 diff
- ④ 逐题表现:题目 / 类型 / 结果(✅保持 / 🔼修好 / 🔽变差)/ **K 次通过(x/K)** / 失败原因,可展开看回答
- 原始 SkillOpt 日志收进可折叠的「详细日志」

**布局**:左右两列**可拖拽调宽**(react-resizable-panels,宽度记忆到 localStorage)——左栏「题集」按 train/val/test 三组手风琴展示(内置题集读 `GET /v1/skillopt/cases`;员工 / LLM 生成题集直接展示所选题集),**运行时高亮"当前被测题"**并自动展开所在组、滚动到可见;右栏配置 + 运行状态。

**运行中视图(三件套,全从 SSE stdout 解析,零后端改动)**:① **指标条**——5 阶段进度 stepper + 「第 X/N 步」+ 总进度% + 本步 rollout 通过率 + **选择集分数 sparkline** + 收/弃/跳计数 + 已运行/阶段/静默计时(**静默 >90s 黄色预警**,识别中转 / LLM 卡死);② **题块热力网格**——当前 rollout 逐题 绿/红/灰,当前题脉冲、hover 看失败原因;③ **活动流**——把日志翻译成业务事件逐条淡入(基线 / 试跑通过率 / 收下·新最优 / 丢弃 / 注入经验 / 留出集 pass^k …),最新一条 pulse、自动滚底;原始 stdout 收进折叠「技术日志」。

**种子来源 + 运行**:UI 永远真跑(复用平台已配的 LLM profile;OpenAI 兼容网关 endpoint 自动补 `/v1`)。种子可选**内置中文客服种子**,或**从所选 Platform 员工技能的英文描述一键生成中文种子**、编辑后驱动评测(mock 流程仅后端保留供测试,UI 不再暴露)。

**题集来源**(三选一,决定拿哪套题去评 / 优化):
- **内置题集** —— 固定客服场景题。
- **该员工题集** —— 把某标准员工题库里「可确定性判分」的题(超范围 / 红线 / 带 `groundTruthChecks`)按 ~5:2:3 确定性切 train/val/test,**≥9 题**才可跑。
- **LLM 生成题集** —— 让所选 LLM 为该 skill 现出一套题。**严守黄金准则「奖励确定性」:LLM 只出题(prompt + 类型 + 判分项),判分仍 100% 走上面的确定性 cascade —— 无 LLM-judge、无循环奖励**;语言标签由平台 `detectLang` 重算(不信 LLM 自报)、未知判分项剔除、题面去重、正反配比闸门(≥9 题且红线 / 正常各 ≥2)。**生成一条显示一条**(流式),可随时**终止**(真正中断在途请求);生成后进**可编辑人审关**(改题面 / 切类型 / 删 / 重生成),确认后才切 5:2:3 喂评测;留出集标注「LLM 生成,需人审通过才作发版依据」。

**高级参数**(`<details>` 折叠,留空=用默认):**被测模型 / 优化器模型**(从已配置 LLM profile **下拉**选,只换模型名、共用同一端点)、**接受准则**(hard 严格全过 / soft 部分给分 / mixed 加权)、**更新模式**(patch 增量编辑 / rewrite 整篇重写)、**慢更新 / 元技能**(三态:默认随配置 / 强制开 / 强制关);每个参数旁有 **ⓘ 术语解释**悬浮。

**保存为报告**:跑完点「保存为报告」→ 把这一轮(配置 / 效果对比 / 优化过程 / 学到什么 / 逐题)存成只读报告,并入左侧**「评测报告」列表**(与 agent 评测报告并列,带「Skill / Agent」类型标签 + 类型筛选);点开走 `/skill-reports/:id`(元信息头卡 + 复用结果仪表盘)。报告**持久化到 Postgres**(`skill_eval_reports` 表)并跨设备 sync,机制同 agent 报告(`useSliceSync` + hydration);**原始 stdout 日志不入库也不上行**(只存结构化 frame + meta;本机内存保留日志供当次预览)。

**发版结论(瑞士奶酪门 + 人审校准/抽审)**:打开已保存报告时,结果仪表盘上方多两块——**① 发版结论卡**:融合「留出提升 + pass^k 保下限 + 人审校准一致率」给明确结论(建议发版 / 谨慎 / 不建议 / 待人审)+ 三信号小卡;**② 校准 / 抽审面板**:逐道留出题列出「题面 + 模型实际回复 + auto 判分 + 原因」,人工标 auto 判得「对 / 错」。**关键不变量**:① **人审是硬前提**——校准没过(覆盖不足 / 一致率低于门槛 / **红线题被翻案**)→ 结论封顶「待人审」,**无论分数多高都不给「建议发版」**(贯彻黄金准则「别只信分数」「需人审通过才作发版依据」);② **红线一票否决**——拦截题人审翻案直接判校准失败;③ 判分仍 **100% 确定性**,这里的「校准」是**人核对确定性判分器准不准**(抓 reward-hacking / 误判),**不引入 LLM-judge**。**门槛(一致率 % / 覆盖 %)由用户逐报告手动输入**(默认 85 / 100),改了即时重算;标注 + 门槛随报告 sync 进 PG(audit 非 logs,正常持久化)。

> SkillOpt 仓(含 `envs/qaplatform/` 的 loader/scorer/adapter、`configs/qaplatform/*.yaml`)是 gitignore 的**嵌套 clone**(`/SkillOpt/`),不进主仓;主仓侧产物见下方项目结构。设计 / 计划文档见 `docs/superpowers/{specs,plans}/`。

---

### 一键启停（推荐）

依赖装好后(前端 `npm install`、后端 `cd server && uv sync`、Postgres 容器存在),用 `scripts/dev.sh` 拉起全套:

```sh
scripts/dev.sh            # = up:幂等拉起 db(docker)+ 后端(:18791,--reload)+ 前端(:5173)
scripts/dev.sh status     # 三件套状态,全活退出码 0
scripts/dev.sh down       # 停后端 + 前端(db 保留;down --db 才停库)
```

nohup 后台化(关终端 / 关 IDE 不掉),pid/log 落 `.run/`(已 gitignore)。→ 打开 http://localhost:5173

### 手动启动(备选)

**前端:**
```sh
git clone <repo>
cd eval-platform
npm install
npm run dev      # http://localhost:5173
```

**后端**(可选 — 没启动时前端用纯 localStorage 模式跑):
```sh
cd server
uv sync                                       # 装依赖进 .venv

# 起 Postgres(根 docker-compose,容器名 agent-evaluator-db-1)
docker compose up -d

uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 18791
```

启动后端后前端**首次加载会自动 boot-hydrate**（从 server 拉所有表合并到本地），之后每一步操作经 Outbox 自动落库，不需要手动同步。

### 常用脚本
```sh
npm run typecheck   # tsc --noEmit
npm run build       # 生产构建 → dist/
npm run preview     # 看构建产物
```

---

## 第一次使用

1. **左导航 → LLM 模型 → 新建**：填 Name / Provider / Base URL / API Key / Model
2. **左导航 → Agent 管理 → 新建**：配置被测 Agent（Mock / AgentCLI / OpenAI Compatible）
3. **左导航 → 标准员工**：选一位（如 Aria），下拉「关联 Agent」绑定到第 2 步的 profile
4. **进入题库 `/library`**：
   - 已有 20 道围绕 Aria 的种子题
   - 「出题 ▼」可选人工 / AI 生成
   - 多选 → 「批量分配员工」一键改归属
   - 多选 → 「去首页答题 →」走批量队列
5. **首页答题**：BulkQueueBar 单跑 / 全跑；多步题自动串发
6. **打分**：JudgeBar 多选 N 个 LLM 自动校准，或人工评分；🤖/🧑 徽章区分
7. **数据看板**（题库右上角 view 切换）：员工 chips → 该员工 scope；底部「📄 生成报告」冻结快照
8. **`/reports`**：查看 / 搜索 / 排序 / 导出 Markdown / 删除

**配置面板**（左导航打开）：


---

## 桥接 agentcli（被测 Agent）

`agentcli` 是本地 CLI，gateway 默认 loopback-only（`ws://127.0.0.1:18789`）。
仓库自带 `bridge/agentcli-bridge.mjs` 在 18790 端口提供 HTTP+SSE 接口：

```
Browser → POST /v1/chat (Bearer token)
        ↓
agentcli-bridge :18790
        ↓
agentcli gateway :18789 (loopback)
```

部署：
```sh
scp bridge/agentcli-bridge.mjs user@host:~/agentcli-bridge/
BRIDGE_TOKEN=$(openssl rand -hex 24) node ~/agentcli-bridge/agentcli-bridge.mjs
curl http://<host>:18790/health
```

`.env.local`：
```ini
VITE_AGENTCLI_BASE_URL=http://127.0.0.1:18790
VITE_AGENTCLI_API_KEY=<BRIDGE_TOKEN>
```

跨机器 SSH 端口转发：
```sh
ssh -f -N -L 18790:127.0.0.1:18790 user@host
```

更多见 [`bridge/README.md`](./bridge/README.md)。

---

## 项目结构

```
eval-platform/
├── src/
│   ├── App.tsx / main.tsx / router.tsx
│   ├── pages/
│   │   ├── WorkspaceLayout.tsx        # 评测中心 /
│   │   ├── LibraryPage.tsx            # 题库 + 看板 /library
│   │   ├── QuestionDetailPage.tsx     # 单题 /library/:id
│   │   ├── ReportsListPage.tsx        # 报告列表 /reports(agent + skill 并列,类型筛选)
│   │   ├── ReportPreviewPage.tsx      # agent 报告预览 /reports/:id
│   │   ├── SkillReportPreviewPage.tsx # skill 报告预览 /skill-reports/:id(元信息头+仪表盘)
│   │   └── SkillOptPage.tsx           # Skill 评测 /skillopt(SSE + 实时状态 + 仪表盘)
│   ├── hooks/use-qa-store.tsx         # 全局 store + boot hydration
│   ├── agents/                        # Agent / LLM 抽象层
│   │   ├── types.ts                   # ProviderKind discriminator
│   │   ├── registry.ts / presets.ts
│   │   └── providers/
│   │       ├── mock.ts                # kind: agent
│   │       ├── agentcli-bridge.ts     # kind: agent
│   │       ├── openai-compat.ts       # kind: llm
│   │       └── anthropic.ts           # kind: llm
│   ├── components/
│   │   ├── agent-panel/               # 左导航 + 会话
│   │   ├── question-panel/
│   │   │   ├── current-task-tab.tsx
│   │   │   ├── evaluation-tab.tsx     # JudgeBar / R2 校准
│   │   │   ├── dashboard-tab.tsx      # 数据看板
│   │   │   ├── employees-tab.tsx      # 6 标准员工
│   │   │   ├── bulk-queue-bar.tsx     # 批量答题进度
│   │   │   ├── generate-questions-dialog.tsx
│   │   │   ├── generate-report-dialog.tsx
│   │   │   └── question-form-dialog.tsx
│   │   ├── library/                   # 题库子组件
│   │   ├── skillopt/                   # Skill 评测组件
│   │   │   ├── run-config-card.tsx     # 配置卡:LLM/种子来源/题集来源/高级参数
│   │   │   ├── case-generator.tsx      # LLM 生成题集:流式 + 终止 + 可编辑人审关
│   │   │   ├── platform-skill-picker.tsx  # 员工→标准员工映射 + 技能二级选择器(复用)
│   │   │   ├── case-sets-card.tsx      # 左栏题集只读展示(train/val/test 手风琴)
│   │   │   ├── info-hint.tsx           # 术语 ⓘ 悬浮解释(Tooltip)
│   │   │   ├── run-metrics-strip.tsx   # 运行中:阶段+进度%+rollout+选择集 sparkline+收弃跳+计时
│   │   │   ├── case-grid.tsx           # 运行中:题块热力网格(当前题脉冲)
│   │   │   ├── activity-feed.tsx       # 运行中:语义事件活动流
│   │   │   ├── stage-stepper.tsx       # 5 阶段进度条
│   │   │   ├── result-dashboard.tsx    # 结果仪表盘(效果/过程/学到啥/逐题)
│   │   │   ├── release-verdict-card.tsx # 报告预览:发版结论卡(融三信号 + 用户门槛输入)
│   │   │   └── calibration-audit-panel.tsx # 报告预览:逐留出题人审(auto 对/错 + 红线高亮)
│   │   ├── employee-avatar.tsx
│   │   └── ui/                        # shadcn / Radix primitives
│   ├── lib/
│   │   ├── api.ts                     # FastAPI 客户端
│   │   ├── outbox.ts                  # 同步队列 + 死信
│   │   ├── use-slice-sync.ts          # diff → enqueue
│   │   ├── hydrate.ts                 # boot hydration
│   │   ├── server-sync.ts             # 一次性整库迁移
│   │   ├── persistence.ts             # localStorage 信封 + KEYS
│   │   ├── judge.ts                   # LLM Judge prompt + 3 层 parser
│   │   ├── question-generator.ts      # AI 出题 + 4 层 parser
│   │   ├── report-export.ts           # 报告 → Markdown
│   │   ├── model-pricing.ts           # 30+ 模型定价表 + 估算
│   │   ├── standard-employees.ts      # demo 员工画像 + ALL_EMPLOYEES_ID
│   │   ├── skillopt-client.ts         # /v1/skillopt/run SSE 客户端 + 富 done 帧类型
│   │   ├── skillopt-stages.ts         # 日志→阶段解析 parseStage / reduceStage
│   │   ├── skillopt-run-events.ts     # 日志→语义事件 parseEvent + 指标累加 reduceMetrics
│   │   ├── skill-report.ts            # Skill 报告类型 + meta/标题/列表指标 + 校准汇总/发版结论 + audit 变换器
│   │   ├── skillopt-diff.ts           # 注入经验抽取 + 种子→最优行 diff
│   │   ├── question-to-skillopt-case.ts # 员工题→case + splitCases 确定性切分
│   │   ├── skillopt-case-gen.ts       # LLM 出题提示词 + 确定性自检/流式增量解析
│   │   ├── skillopt-seed-prompt.ts    # 技能描述→中文种子 prompt + 锚点
│   │   └── mock-data.ts               # 20 道种子题
│   └── types/index.ts                 # EvaluationReport / ReportItem 等
├── server/                            # FastAPI 后端
│   └── app/
│       ├── main.py
│       ├── db.py                      # asyncpg + timezone + 启动迁移
│       ├── models.py                  # 8 张表
│       ├── skillopt_runner.py         # 驱动 SkillOpt 子进程 + 组装脱敏富 done 帧
│       └── routes/
│           ├── agents.py / llms.py
│           ├── questions.py
│           ├── conversations.py / messages.py
│           ├── evaluations.py
│           ├── reports.py             # agent 评测报告 CRUD
│           ├── skill_reports.py        # Skill 评测报告 CRUD /skill-reports(logs 落库前清空)
│           ├── settings_kv.py
│           ├── skillopt.py            # POST /v1/skillopt/run(SSE)
│           └── migrate.py             # 整库导入
├── scripts/
│   └── dev.sh                         # 一键启停 db/后端/前端(up/down/status)
├── SkillOpt/                          # microsoft/SkillOpt 嵌套 clone(gitignore,本地参考)
│   └── skillopt/envs/qaplatform/      #   平台专属 env:loader/scorer/adapter + configs
├── bridge/
│   ├── agentcli-bridge.mjs            # HTTP+SSE 中转
│   └── README.md
└── public/agents/                     # demo 员工头像(缺省用 emoji)
```

---

## 技术栈

| 类别 | 选型 |
| --- | --- |
| Build / Bundler | Vite 6 |
| UI 框架 | React 18 + TypeScript 5 严格模式 |
| 样式 | Tailwind CSS 3 |
| 组件原语 | Radix UI（Dialog / Dropdown / Popover / Select / Tabs / ScrollArea / Slider / Tooltip / Checkbox / Sheet / Separator） |
| 路由 | React Router |
| 图标 | lucide-react |
| 布局 | react-resizable-panels（可拖拽两栏） |
| Markdown | 自研 Markdown 组件 |
| 图表 | 手撸 SVG（DonutChart / TrendChart） |
| 后端 | FastAPI + SQLModel + asyncpg |
| 数据库 | Postgres 17（Docker，时区 Asia/Shanghai） |
| 持久化（前端） | localStorage 信封式 + Outbox 队列同步 |
| Agent 桥接 | Node.js + `ws`（HTTP+SSE → agentcli loopback gateway） |

---

## 标准化路线图进度（P0 / P1 / P2）

> 平台的北极星是把[《评测黄金准则》](docs/EVAL-GOLDEN-STANDARD.md)落成**可执行的标准化评测流程**(5 对象 + 5 步生命周期 + 强约束闸门)。下表对照该路线图 v1 列出当前进度,**`⬜ 未完成`项即下一步重点**。(图例:`✅` 已落地 · `◑` 部分 · `⬜` 未做)

### P0 — 不做就不算「标准化平台」(基本落地)

| # | 能力 | 状态 |
|---|---|---|
| 1 | StandardEmployee 数据模型 | ✅ |
| — | EvaluationPlan + 冻结机制(防"边测边调目标") | ⬜ 曾移除,待重做(校准前置 / 超范围清单等的载体) |
| 2 | 预置 demo 员工 + 每位 2-3 专属指标模板 | ✅ |
| 3 | 题目扩字段(passForm/failForm/outOfScope/hasGroundTruth/severity/author/intent/targetEmployeeId) | ✅ |
| 4 | 内置通用指标 + 强约束 | ◑ 强约束闸门 `canRelease` 已落;通用指标仍用 3 维度(准确性/专业性/语气),未上"6 项模板" |
| 5 | Pass / Fail 双向 | ✅ |
| 6 | Judge 强隔离校验(禁同 profile / 同型号告警) | ✅ |
| 7 | 强约束闸门(2 项任一不达 → `canRelease=false`) | ✅ |

### P1 — 让评测过程可信(部分完成)

| # | 能力 | 状态 |
|---|---|---|
| 10 | 多 trial / pass^k(稳定性,压单次噪声) | ✅ 主评测线(`multi-trial.ts`)+ **SkillOpt 留出集 pass^k** 均已落 |
| 14 | 不确定信号检测(措辞软化 / 反问 / 拒答) | ✅ |
| 8 | 校准:放量前 30-50 条「人 vs 自动」agreement **≥85% 门禁** | ◑ soft 读出已落:数据看板「校准 · 人 vs 自动」卡(按 messageId 配对人/自动判 → ≥85% 门禁徽标 + 分歧列表 + 建议);未做硬阻断放量 / 30-50 采集流程 |
| 9 | 抽审队列(自动 PASS 随机 10-20% 入人工复核) | ◑ 派生只读卡已落:数据看板「抽审队列 · 人工复核」(自动 PASS 按 messageId 去重 → 确定性哈希抽样,**P0/红线 100% 全抽**,比例可配 0–100% 默认 15% 持久化;"已复核"= 同回答已有人工判,人推翻自动 PASS → 漂移告警);未做正式工单/assignee / 跳转复核界面 |
| 11 | adversarial / 超范围清单自动跑 + 边界识别率 | ◑ AI 出题「对抗·超范围」模式已落(注入/套取内部标识/越狱/超范围探针,自动打 outOfScope+no-leak 标 → 边界识别率);≥20 条套件内容待积累、红线题型升级(挂 floorElement)未做 |
| 12 | 盲测校验(评分人 ≠ 题目作者) | ⬜ 未做 |
| 13 | A / B 类报告生成器(B 类自动差异对比) | ⬜ 未做(已有报告 + 指标块,缺自动 A/B 对比) |

### P2 — 平台化深化(后端已就位,多数待开)

| # | 能力 | 状态 |
|---|---|---|
| 15 | 全量对话日志归档 ≥180 天 | ◑ PG 已全量持久化、无清理逻辑;只差「留存策略」声明 |
| 19 | 元数据泄漏关键词扫描(内部 ID / SIGNAL / thinking) | ◑ SkillOpt 打分侧已有 no-leak 红线;平台通用扫描未做 |
| 16 | 实时指标看板告警 + 累计 3 起静默错误自动停用 | ⬜ 未做(看板有,实时告警 / 自停没有) |
| 17 | 4 段灰度状态管理 + 5 条中止条件实时判定 | ⬜ 未做 |
| 18 | 满意度采集渠道(站内反馈 / 表单 / NPS) | ⬜ 未做 |
| 20 | L1-L4 自治等级在 skill / 题目层标注 | ⬜ 未做 |

**下一步重点(未完成项里优先级最高)**:P1 的 **盲测(12)/ A-B 报告(13)** —— 校准(8 soft 档)、adversarial(11 出题工具)、抽审队列(9 派生只读卡)均已落 soft 档,见上;校准看「判官准不准」、抽审看「放量后持续别漂」,二者咬合;且 platform 真连接已打通、有真实非确定性数据可测;**EvaluationPlan(P0)** 作为承载"校准前置 / 超范围清单 / 冻结目标 / 硬门禁放量 / 抽审硬阻断"的载体需一并重做。

---

## 可演进方向（参考同类平台）

参考 Clawvard / Arize Phoenix / Langfuse / Maxim / DeepEval 五个同类平台后，列出后续可纳入的扩展点。按价值优先级分 Tier，仅记录"可做的方向"，不代表已开工。

### Tier 1 — 评测能力深度

| # | 扩展点 | 借鉴自 | 价值 |
|---|---|---|---|
| 1.1 | **RAG 4 大评测指标**：Faithfulness / Answer Relevancy / Contextual Recall / Contextual Precision | DeepEval, Arize, Maxim | demo 员工(如 Aria / Sam)会调用 Skills + 知识库，检索质量是核心，目前 3 维度看不出"答案是不是从知识库扯出来的" |
| 1.2 | **Agent 6 维度专属指标**：Task Completion / Tool Correctness / Argument Correctness / Step Efficiency / Plan Adherence / Plan Quality | DeepEval | Agent 不只是"答得对不对"，**工具用没用对 + 步骤合不合理** 是被测核心 |
| 1.3 | **多轮对话指标**：Conversation Completeness / Knowledge Retention / Role Adherence / Turn Relevancy | DeepEval, Maxim | 已支持 subPrompts，但只对每一步打分；整段对话是否一致、有没有掉角色、有没有忘前文，缺量化 |
| 1.4 | **安全 / 红队评测**：Bias / Toxicity / PII Leakage / Prompt Injection / Misuse / Role Violation | DeepEval (DeepTeam), Maxim | 商用 SaaS 必备；Platform 出海合规 / 涉外 / 涉资场景需要红线检测 |
| 1.5 | **G-Eval / DAG 自定义指标** | DeepEval | 让业务方能自己写"我要测 XXX 形态"的自然语言准则（G-Eval）或决策树（DAG），不用改代码 |

### Tier 2 — 流程 / 工程

| # | 扩展点 | 借鉴自 | 价值 |
|---|---|---|---|
| 2.1 | **数据集 (Dataset) + 实验 (Experiment) 模型** | Langfuse, Maxim, Phoenix | 把题库切成"可命名复用的 dataset"，跑同一 dataset 多次形成 experiment runs，自动 side-by-side 对比 |
| 2.2 | **CI / 自动化阈值门禁**：metric < threshold → 评测失败 + 阻塞发布 | DeepEval (pytest), Langfuse, Maxim | 业务方关心的"能不能放量"门禁代码化 |
| 2.3 | **Annotation Queue**：未打分题进队列 → 多人轮流处理 + 标注合并 | Langfuse, Maxim "Last-mile" | 人工抽审 10-20% 的流程目前是散的，缺正式队列 |
| 2.4 | **多类型 Score**：除 0-10 数字，支持 categorical / boolean / 文本备注 | Langfuse | 有些维度天然是"是 / 否 / 不适用"，强行 0-10 失真 |
| 2.5 | **Judge 解释默认显示** | Arize | R2 校准只暴露 verdict + scores，raw reasoning 藏在 calibrationSnapshots，建议每条 judge 默认显示 1-2 句 reasoning |
| 2.6 | **合成数据生成 (Synthesizer)** | DeepEval | 让 LLM 从员工 SOP / Skills 文档自动生成测试集（含 reasoning / multi-context / hypothetical 等 Evolution 策略）；当前「AI 出题」只能按 Skill，源头窄 |

### Tier 3 — 平台体验

| # | 扩展点 | 借鉴自 | 价值 |
|---|---|---|---|
| 3.1 | **可分享的只读报告链接** + 带 token 公开页 | Clawvard | 业务方 / 客户能看只读 URL，不需要登录 |
| 3.2 | **历史对比 / 趋势**：同 agent 多次报告 side-by-side（哪些题 pass → fail、新增 / 删除） | Maxim, Langfuse | 报告功能已有，但没自动 B 类对比 |
| 3.3 | **3 层 observability**：Session / Trace / Span | Maxim, Arize | 单条评测可下钻看 spans（哪一步耗时多 / 哪个工具调用失败） |
| 3.4 | **程序化校验**：JSON Correctness / SQL Correctness / 正则匹配 / 数值区间 | Maxim 程序化, DeepEval | 规则化判分不调 LLM，省成本省时间 |
| 3.5 | **基准跑分（MMLU / GSM8K / HumanEval / TruthfulQA …）** | DeepEval | 与对外宣称比对的硬数据 |

### Tier 4 — 部署 / 企业（远期）

| # | 扩展点 | 借鉴自 |
|---|---|---|
| 4.1 | RBAC + SSO（多人协作 + 权限分级） | Maxim |
| 4.2 | In-VPC / on-prem 一键部署包 | Maxim |
| 4.3 | 公开 API + Webhook（外部系统接入评测结果） | Langfuse, Maxim |

---

## 许可证

MIT — 见 [`LICENSE`](./LICENSE)。

---

> Repo: <https://github.com/JavaLyHn/eval-platform>

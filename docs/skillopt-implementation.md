# SkillOpt 实现原理 & 本平台「Skill 评测」完整流程

> 日期:2026-06-08。本文基于对 `SkillOpt/`(gitignored 嵌套仓)与平台前后端代码的完整通读整理。
> 一句话定位:**SkillOpt 是一个"模型冻结、只优化 skill 文本"的反思式优化器(ReflACT);平台的「Skill 评测」是它的前门——出题 + 起子进程跑它 + 流式收进度 + 渲染仪表盘。两者都不是强化学习(无权重更新)。**

---

# 第一部分:SkillOpt 实现原理

## 1. 本质与定位

SkillOpt 优化的对象是**一份 Markdown 技能文档(skill.md)**,不是模型权重。被测模型(target)全程**冻结**,只通过 API 推理。它借用了 SGD/RL 的全套词汇,但全部发生在**文本空间**:

| RL/SGD 词汇 | 在 SkillOpt 里的真身 |
|---|---|
| policy(策略) | **skill 文本本身**(被优化的变量) |
| reward(奖励) | grader 的 `hard`(0/1 红线/总判)+ `soft`(子项通过占比) |
| gradient(梯度) | analyst LLM 读轨迹后产出的**文字 patch**(自然语言批评 → 编辑建议) |
| learning rate | `edit_budget` = 每步允许的编辑条数(`scheduler.py:1-3` 明示) |
| gradient accumulation | `accumulation`(累积多个 minibatch 的 patch 再合并) |
| optimizer step | 应用编辑 + gate 接受/拒绝(爬山) |
| momentum / 慢更新 | epoch 级 `slow_update`(纵向对比上一 epoch) |
| minibatch / epoch / batch_size | 配置里同名 |

**双模型角色**(`skillopt/model/__init__.py`):
- **target**:`chat_target` —— 戴上当前 skill 当 system prompt,实际答题的"被测 agent"。
- **optimizer**:`chat_optimizer` —— 充当 analyst(反思)、merge(合并)、rank(选择)、rewrite(重写)的"改写者"。
- 后端支持 `azure_openai / openai_chat / claude / codex / qwen / minimax`;**OpenAI 兼容中转**通过 `auth_mode="openai_compatible"` 走纯 `OpenAI(base_url=...)` 客户端(`azure_openai.py:294-300`)。
- 在**平台真跑**里,`model.target` 与 `model.optimizer` 都被设成用户选的同一个 model(见第二部分)。

## 2. 六阶段主循环(`engine/trainer.py`)

```
for epoch in 1..num_epochs:
  for step in 1..steps_per_epoch:               # steps = ceil(train_size / (batch_size*accumulation))
    for a in 1..accumulation:
      ① ROLLOUT   戴当前 skill 在 minibatch 上答题 → {hard,soft,轨迹}
      ② REFLECT   analyst 读失败/成功轨迹 → patch(edits)
    ③ AGGREGATE  跨 minibatch 分层合并 patch → merged_patch
    ④ SELECT     按 edit_budget 排序裁剪(rank_and_select)→ ranked_patch
    ⑤ UPDATE     把编辑落到 skill 文档 → candidate_skill
    ⑥ EVALUATE   candidate 在「选择集 valid_seen」上重跑 → gate 接受/拒绝
  [epoch 末] SLOW UPDATE(纵向对比注入经验) + META SKILL(优化器记忆)
[全部 epoch 末] 留出集 valid_unseen 上 pass^k 终评 + 写 summary.json
```

### ① ROLLOUT(`adapter.py:63-116`)
对每道 case:`system = skill`、`user = case.prompt + 结构化输出指示`(`target_io.py`,要求只输出一个 JSON:`reply/intentType/slots/requiresClarification/intercepted`)→ `chat_target` → `parse_target_output` 容错抽 JSON → `score_output(case, out)`。每道题落盘最小轨迹到 `predictions/<id>/conversation.json`(user 题 + assistant 答 + system 里写 `[grader] hard/soft/reason` + signals)。**不落这个文件,reflect 就读到空 → 0 edits**(历史踩过的坑)。

### ② REFLECT(`gradient/reflect.py`)
把 rollout 结果按 `hard<1` / `hard==1` 分成失败组/成功组,各切成 `minibatch_size` 大小,线程池并行调 analyst:
- `run_error_analyst_minibatch` / `run_success_analyst_minibatch` 各自带不同 system prompt(`analyst_error` / `analyst_success`)。
- analyst 读 `predictions/<id>/conversation.json` 的轨迹文本,产出 `{"patch": {"reasoning","edits":[{op,target,content}]}, "source_type":"failure|success"}`,并按 `edit_budget` 截断。
- `op` ∈ `append / insert_after / replace / delete`。

### ③ AGGREGATE(`gradient/aggregate.py:merge_patches`)
把所有失败/成功 patch 用 optimizer LLM **分层合并**成单个 `merged_patch`,落 `steps/step_NNNN/merged_patch.json`。

### ④ SELECT(`optimizer/clip.py:rank_and_select`)
`edit_budget` 是"学习率":
- **scheduler**(`scheduler.py`):`constant / linear / cosine` 从 `max_lr=edit_budget` 衰减到 `min_lr`。
- **clip**(梯度裁剪类比):编辑条数 > 预算时,optimizer LLM 排序选 top-K(失败回退取前 K)。
- **autonomous LR**(`lr_autonomous.py`):可让 LLM 看分数/历史自己定该步改几条(钳到可用条数)。
> 注:这里的"clip"只裁**条数**,没有梯度范数那种幅度裁剪。

### ⑤ UPDATE — 三种模式(`optimizer/update_modes.py`)
- **`patch`(默认)**:`apply_patch_with_report` 顺序应用 edits(`append/insert_after/replace/delete`,replace/delete 只改首个匹配)。
- **`rewrite_from_suggestions`**:optimizer LLM 拿建议清单**整篇重写** skill(`new_skill` 全量替换)。
- **`full_rewrite_minibatch`**:reflect 直接产出整篇候选,跳过 SELECT,取第一个非空 `new_skill`。

### ⑥ EVALUATE + 接受/拒绝门(`evaluation/gate.py`)
- `select_gate_score(hard,soft,metric,w)`:`hard` 直接用 hard;`soft` 用 soft;`mixed` = `(1-w)*hard + w*soft`。默认 `gate_metric="hard"`。
- candidate 在**选择集 `valid_seen`** 上重跑(按 `skill_hash` 缓存),`evaluate_gate` **纯函数**判定:
  - `cand > current && cand > best` → **accept_new_best**(同时更新 current + best)
  - `cand > current`(但不破纪录)→ **accept**(只更新 current)
  - 否则 → **reject**(current/best 都不动 = 回滚)
- **严格大于即接受,无容忍阈值**。`valid_seen` 是训练中每步用的验证集;`valid_unseen` 是**只在最后跑一次**的留出/测试集,训练全程不碰。

## 3. 评分 cascade(`envs/qaplatform/scorer.py:score_output`)

按顺序短路:
0. **无作答**:`responded=False` 或答案空 → `hard=0`。
1. **全局 no-leak 红线 gate**:答案含 blocklist 词(`SIGNAL/<thinking/面板ID/panel_id/internal_id…`)且用户原文没出现(**回声豁免**)→ `hard=0, reason=safety-leak`(**跨所有题型一票否决**)。
2. **interception 题**:比对 `intercepted` 是否符合 `expected` → hard 1/0,直接返回。
3. **acceptAny 题**:3 个子项(是否需澄清 / 回复语言 / 确定性 ground-truth)→ `soft=通过数/3`,任一挂则 `hard=0`。
4. **standard 题**:按 `expected` 里出现的键加子项(意图判别 / 是否需澄清 / 槽位提取 / 回复语言)+ 确定性检查 → `soft=通过数/总数`,任一挂则 `hard=0`。

确定性 ground-truth 检查(`run_ground_truth_checks`):`lang-match`(脚本判语言)/ `no-leak` / `tool-succeeded`(发布类工具零错)/ `no-placeholder`(无 `{{}}`/`[name]`)。

## 4. 慢更新 & 元技能(epoch 级)

- **slow_update**(`optimizer/slow_update.py`):epoch 末,用**上一 epoch 末 skill** 和**本 epoch 末 skill** 在同一批 20 样本上各跑一遍,组**纵向对比对**(improved/regressed/persistent_fail/stable_success),optimizer 据此写一段经验文本,**注入 skill 文档末尾的 `<!-- SLOW_UPDATE_START/END -->` 区块**。该区块在步级编辑里**受保护、不被改动**。接受策略:默认 **force-accept**(无条件注入 current+best);可选 `slow_update_gate_with_selection` 走选择集门控。
- **meta_skill**(`optimizer/meta_skill.py`):**不改 skill 文档**,而是写"优化器该怎么更好地改"的经验(`meta_skill_result.json`),下个 epoch 喂给 reflect/aggregate/select/autonomous-LR 当上下文。

## 5. pass^k(`engine/passk.py:aggregate_passk`)

每道留出题跑 K 次:`passk=1` **当且仅当 K 次全过**(保下限口径);`mean_hard` = K 次平均通过率(水位)。终评(`eval_test`)对 **seed 初始 skill** 和 **best_skill** 各在 `valid_unseen` 上跑 K 次,写 `summary.json` 的 `baseline_test_passk / test_passk / test_delta_hard`。`test_passk` 由 `evaluation.test_passk` 配(默认 1,平台默认 3)。

## 6. 数据切分 & 落盘

- 切分:`train/`(rollout 输入)/ `val/`=valid_seen(选择集,gate 用)/ `test/`=valid_unseen(留出集,pass^k 终评)。`split_mode` 可 `split_dir`(直接读目录)或 `ratio`(按比例切,默认 2:1:7)。
- 落盘:`skills/skill_vNNNN.md`(每步快照)、`best_skill.md`、`history.json`、`runtime_state.json`(精确续跑)、`steps/step_NNNN/*`(merged/ranked/candidate/apply_report/digest)、`slow_update/`、`meta_skill/`、`summary.json`、`test_eval[_baseline]/results.json`、`config.json`(脱敏)。

## 7. mock 模式

`env.mock=true` 时 rollout **不调 LLM**,直接用 case 里的 `mock` canned 答案过**真实 scorer**(验证脚手架/数据/评分,不烧 token);reflect 产出合成 patch。平台 mock 走 `tiny_mock.yaml` + `cases`(带 canned 答案)。

## 8. 明确:没有强化学习/权重更新

- 全仓**无** `torch/tensorflow/jax/transformers/trl` 等,无反向传播、无 PPO/GRPO、无 reward 梯度、无参数更新。
- "gradient"目录、"learning rate""clip"都是**文本空间的类比**(`scheduler.py:1-3`、`clip.py:1-6` 注释自承)。
- 每一步"update"都是对一份 Markdown 的**文本增删改**。属 **GEPA / TextGrad / Reflexion(verbal reinforcement)** 同族:**training-free / inference-only 的提示词(技能)空间搜索**。

---

# 第二部分:本平台「Skill 评测」完整流程

## 架构总览

```
[前端 SkillOptPage] --POST /v1/skillopt/run(SSE)--> [FastAPI 路由]
        │                                                  │
        │                                          [skillopt_runner]
        │                                                  │ 起子进程(密钥注入 env,不进 argv)
        │                                                  ▼
        │                                    python scripts/train.py --config ... --cfg-options ...
        │                                                  │ stdout(逐行)
        │  <--SSE: start / log×N / done(读磁盘产物) / error-- │
        ▼
[skillopt-stages/run-events 解析 → RunStatus/RunMetrics/RunEvent] → [运行中 指标条+题块网格+活动流 / 完成 ResultDashboard]
```
**关键事实:平台没有自己的优化算法**,它只是 SkillOpt `scripts/train.py` 的"调用 + 收进度 + 画结果"层。

## ① 触发(`src/pages/SkillOptPage.tsx` + `run-config-card.tsx` + `skill-browser.tsx`)

用户在右侧配置:
- **LLM profile**:下拉(kind=llm),须有 `baseUrl/apiKey/model`(`canRun` 三者齐全才可跑)。
- **种子来源**:`内置中文种子`(`skills/initial.md`)或 `从员工技能生成`——后者走 Platform **只读**接口:`api.platform.employees()` → `api.platform.skills({templateId})` 取该员工技能,再 `buildSeedGenPrompt(name,description)`(`skillopt-seed-prompt.ts`)让 LLM 扩写成「## 角色 / ## 通用应答原则 / ## 安全红线 / ## 输出规范」四节中文 skill.md,`ensureAnchors()` 保证末尾带 `<!-- SLOW_UPDATE_START/END -->`。
- **epochs / passK**:数字输入。

`start()` POST body:`{ mock:false, epochs, passK, llm:{baseUrl,apiKey,model}, seedSkillContent? }`,以 **ReadableStream** 手工解析 SSE 帧(非 EventSource)。左栏题集另由 `GET /v1/skillopt/cases` 拉。

## ② 后端(`server/app/routes/skillopt.py` + `skillopt_runner.py`)

- 路由 `POST /v1/skillopt/run` → `EventSourceResponse(run_skillopt_stream(body))`。
- `build_command()`:
  - 配置:`mock→tiny_mock.yaml`,`real→tiny_real.yaml`;case dir:`cases`(mock)/`cases_m1`(real)或请求覆盖。
  - `--cfg-options`:`env.out_root=outputs/run_{id}`、`env.split_dir=...`、`env.skill_init=<seed路径>`、(real)`model.target=model`、`model.optimizer=model`、`train.num_epochs`、`evaluation.test_passk`。
  - `seedSkillContent` 非空 → 写 `outputs/run_{id}/seed_skill.md` 并指给 `env.skill_init`。
  - argv = `[skillopt_python, "scripts/train.py", "--config", cfg, "--cfg-options", ...]`(`skillopt_python` = `SkillOpt/.venv/bin/python`,root 默认 `../SkillOpt`,可 `SKILLOPT_DIR` 覆盖)。
- **密钥注入(绝不进 argv/git)**:复制 `os.environ` 后注 `AZURE_OPENAI_ENDPOINT=base_url`(**强制补 `/v1` 后缀**,否则网关返 HTML 致 `'str' has no attribute 'choices'`)、`AZURE_OPENAI_API_KEY`、`AZURE_OPENAI_AUTH_MODE=openai_compatible`;`PYTHONUNBUFFERED=1` 保证 stdout 实时。
- `asyncio.create_subprocess_exec(*argv, cwd=root, env=env, stdout=PIPE, stderr=STDOUT)`。

## ③ 流式(SSE 事件)

- `{"type":"start","outDir","mock"}` 起跑前。
- `{"type":"log","line"}` 每行 stdout(实时)。
- `{"type":"done","exitCode":0,"bestSkill","seedSkill","summary","history","cases"}` —— exit 0 时从磁盘读 `best_skill.md / summary.json / history.json / test_eval[_baseline]/results.json` 组装(`build_done_frame`)。
- `{"type":"error","message","exitCode","bestSkill?"}` —— 非零退出 / 找不到 SkillOpt。

## ④ 前端解析(`src/lib/skillopt-stages.ts`)

每条 `log` 经 `reduceStage(prev,line)` 累积成 `RunStatus`:
- `parseStage` 把 stdout 模式映射到阶段:`BASELINE…→baseline`、`[STEP N/M]→train`(取当前/总步)、`[1/6 done] hard/soft→train`、`[slow update]/[META SKILL→enrich`、`…TEST —→heldout`、`Final Summary→done`。
- `CASE_RE = /\[case (\d+)\/(\d+)\] id=(\S+) hard=([01]) soft=([\d.]+)(?: reason=(.*))?$/` → 更新 `currentCaseId`(喂左栏高亮)、`caseDone/caseTotal/caseResults`;新一轮(i===1)重置。
- 阶段切换时清空逐题状态。

## ⑤ 仪表盘

- **运行中视图(三件套,`skillopt-run-events` 解析驱动)**:① `RunMetricsStrip`——`StageStepper`(baseline→train→enrich→heldout→done)+ 第 X/N 步 + 总进度% + 本步 rollout 通过率 + 选择集分数 sparkline + 收/弃/跳 + 计时(墙钟/本阶段/距上次输出,静默>90s 警告);② `CaseGrid`——题块热力网格(绿/红/灰,当前题脉冲,hover 看原因);③ `ActivityFeed`——语义事件流(收下·新最优/丢弃/注入经验/留出集 pass^k 等,最新 pulse、自动滚底)。原 `RunStatusCard` 已退役。
- **完成 `ResultDashboard`** 四块:
  - `ConclusionBar` 一句话结论(留出集质量分 X→Y、通过 P/Q 题)。
  - **① 效果对比**:seed vs best 的 hard 通过率 / soft 质量分 / **pass^k 行**(`baseline→best`,标 `K=`,来自 `summary.testPassk/baselineTestPassk/testK`)。
  - **② 优化过程**:`history` 节点时间线(每步 accept/reject + rolloutSoft,点开看 epoch/分数/动作/skill 长度/耗时;有"注入经验 ✦"节点)。
  - **③ 学到了什么**:`best_skill.md` 里 `SLOW_UPDATE` 区块内容(`extractLearnedGuidance`),含"种子→最优"逐行 LCS diff + 复制/下载。
  - **④ 逐题表现**:`cases`(留出集 baseline vs best 合并)每题 `✅保持/🔼修好/🔽变差/❌仍未过` + pass^k `passCount/k` + 失败原因 + 展开看 best 答案。
- **左栏 `CaseSetsCard`**:`/v1/skillopt/cases` 拉 train/val/test 折叠列表;`highlightId`(=currentCaseId)变化时自动展开+滚动到该题+脉冲"评测中"。

## ⑥ ground-truth 复用(同口径、分两处执行)

`src/lib/ground-truth-check.ts` 定义 4 类确定性检查(`lang-match / no-leak / tool-succeeded / no-placeholder`),与 SkillOpt Python scorer **同口径**。共享的是**规格**——case JSON 里的 `groundTruthChecks` 字段(`read_case_sets` 透出、`CaseSetsCard` 显示"判分项");执行分两处:平台 live 评测用 TS 侧,SkillOpt 优化用 Python 侧。**reward 复用确定性 ground-truth**正是此意。

## ⑦ 题集 & 种子

- mock:`cases`(带 canned 答案);real:`cases_m1`(`train/val/test` 各 `items.json`,字段 `id/prompt/caseType/task_type/expected/groundTruthChecks`)。
- 种子:`内置`=`skills/initial.md`;`生成`=Platform 技能 → `buildSeedGenPrompt` → LLM 中文四节 skill.md → `ensureAnchors`,作为 `seedSkillContent` 入库到 `outputs/run_{id}/seed_skill.md` 经 `env.skill_init` 喂入。

---

## 一句话总结

- **SkillOpt**:文本空间的反思式技能优化器(ReflACT)——戴 skill 跑题拿分(reward)→ analyst 读轨迹产文字 patch(gradient)→ 合并/裁剪(lr)→ 改 skill → 选择集 gate 爬山接受/拒绝 → epoch 末慢更新注入经验 → 留出集 pass^k 终评防过拟合。**模型冻结,改的只是 skill 文本,不是 RL。**
- **平台「Skill 评测」**:配置(员工技能→种子 / epochs / passK / LLM)→ 后端起子进程跑 SkillOpt(密钥走 env 不进 git)→ SSE 实时进度 → 仪表盘(效果/过程/学到啥/逐题 + pass^k + best_skill diff)。**它是前门,引擎是 SkillOpt。**

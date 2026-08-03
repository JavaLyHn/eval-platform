# SkillOpt 参数全解

> 日期:2026-06-08。基于 `SkillOpt/configs/_base_/default.yaml` + `configs/qaplatform/{tiny_real,tiny_mock}.yaml` + 引擎代码。
> SkillOpt 是"模型冻结、只优化 skill 文本"的反思式优化器(ReflACT),参数全部借用 DL/RL 词汇但发生在文本空间。配套阅读:`docs/skillopt-implementation.md`。

---

## 一、WebUI 那 8 个旋钮(`skillopt_webui` 首屏的 "Hyperparameters / DL Analogy")

| 控件 | 配置 key | 含义 | DL/RL 类比 |
|---|---|---|---|
| **Learning Rate (max edits/step)** | `optimizer.learning_rate` | 每个 step **最多改几条编辑**(edit_budget) | 学习率(步子大小) |
| **LR Scheduler** | `optimizer.lr_scheduler` | edit_budget 随训练**怎么衰减**:constant/linear/cosine | 学习率调度 |
| **Epochs** | `train.num_epochs` | 整个训练集**过几遍**;**≥2 才触发**慢更新/元技能 | epoch |
| **Batch Size (tasks per step)** | `train.batch_size` | 每个 step **rollout 多少道题** | 批大小 |
| **Analyst Workers (parallel reflection)** | `gradient.analyst_workers` | 反思阶段**并行多少个 analyst 调用** | 数据并行度 |
| **Slow Update (epoch-boundary momentum)** | `optimizer.use_slow_update` | epoch 末做纵向对比、把经验注入 skill 受保护区块 | 动量 |
| **Meta Skill (cross-epoch optimizer memory)** | `optimizer.use_meta_skill` | 跨 epoch 的"优化器该怎么改得更好"记忆(不改 skill 本体) | 优化器状态/经验 |
| **Gate (validation-based accept/reject)** | `evaluation.use_gate` | 候选 skill 在选择集上**涨分才接受、否则回滚** | 验证集早停/接受准则 |

---

## 二、完整配置参考(按 section)

### `model.*` —— 模型角色与后端
| key | 默认 | 含义 |
|---|---|---|
| `optimizer` | gpt-5.5 | **优化器模型**:做反思/合并/排序/重写的 LLM |
| `target` | gpt-5.5 | **被测模型**:戴 skill 答题的 agent |
| `backend` / `optimizer_backend` / `target_backend` | openai_chat | 各自后端:`openai_chat / azure_openai / claude_chat / qwen_chat / minimax_chat / codex_exec / claude_code_exec` |
| `reasoning_effort` | medium | 推理强度(off/low/medium/high);**空串=不发该参数**(平台真跑设空,防 Claude thinking 触发网关 400) |
| `rewrite_reasoning_effort` / `rewrite_max_completion_tokens` | "" / 64000 | rewrite 模式专用的推理强度 / 最大输出 token |
| `azure_openai_*`(endpoint / api_version / api_key / auth_mode / ad_scope / managed_identity) | "" | 端点与鉴权;**支持共享 + 按角色(`optimizer_azure_openai_*` / `target_azure_openai_*`)分别覆盖**。`auth_mode=openai_compatible` 即平台走中转的模式 |
| `codex_exec_*` / `claude_code_exec_*` | — | 用 codex / claude-code 作 exec 后端时的沙箱、审批策略、思考 token 等 |
| `minimax_*` | — | MiniMax 后端的 base_url / key / 温度 / max_tokens |

> 关键:**target 和 optimizer 是两个独立角色**,可用不同模型/后端(平台真跑里被强制设成同一个)。

### `train.*` —— 训练规模
| key | 默认 | 含义 |
|---|---|---|
| `num_epochs` | 4 | 训练集过几遍 |
| `train_size` | 0 | 训练集大小(0=从切分自动推断) |
| `batch_size` | 40 | 每 step 的题数 |
| `accumulation` | 1 | **梯度累积**:一个 step 内累积几个 batch 的 patch 再合并更新 |
| `seed` | 42 | 随机种子(shuffle/分批),保证可复现 |

> 派生:`steps_per_epoch = ceil(train_size / (batch_size × accumulation))`。

### `gradient.*` —— 反思(梯度)阶段
| key | 默认 | 含义 |
|---|---|---|
| `minibatch_size` | 8 | 每次 analyst 调用**看几条轨迹**(M) |
| `merge_batch_size` | 8 | aggregate 阶段每次**合并几个 patch** |
| `analyst_workers` | 16 | 并行 analyst 调用数(线程池) |
| `max_analyst_rounds` | 3 | 最多反思轮数 |
| `failure_only` | false | 只反思失败(跳过 success analyst) |

### `optimizer.*` —— 更新策略
| key | 默认 | 含义 |
|---|---|---|
| `learning_rate` | 4 | = edit_budget,每步最多改几条 |
| `min_learning_rate` | 2 | 衰减调度的下限 |
| `lr_scheduler` | cosine | edit_budget 衰减曲线:constant / linear / cosine / autonomous |
| `lr_control_mode` | fixed | `fixed`(用 scheduler)/ `autonomous`(LLM 自己定每步改几条)/ `none` |
| `skill_update_mode` | patch | `patch`(增量增删改)/ `rewrite_from_suggestions`(按建议整篇重写)/ `full_rewrite_minibatch`(直接产整篇候选) |
| `use_slow_update` | true | 开 epoch 末慢更新 |
| `slow_update_samples` | 20 | 慢更新用多少样本做**上一 epoch vs 本 epoch** 纵向对比 |
| `slow_update_gate_with_selection` | false | 慢更新是否也走选择集门控(false=**force-accept** 无条件注入) |
| `longitudinal_pair_policy` | mixed | 慢更新取哪些对比对:`mixed`全要 / `changed`只要变了的(修好·变差)/ `unchanged`只要稳定的(一直对·一直错) |
| `use_meta_skill` | true | 开元技能(跨 epoch 优化器记忆) |

### `evaluation.*` —— 评估 / 门禁
| key | 默认 | 含义 |
|---|---|---|
| `use_gate` | true | 开接受/拒绝门(本分支强制 true) |
| `gate_metric` | hard | 门禁用哪个分判:`hard`(0/1 红线+总判)/ `soft`(子项占比)/ `mixed` |
| `gate_mixed_weight` | 0.5 | mixed 时 soft 的权重 `(1-w)·hard + w·soft` |
| `sel_env_num` | 0 | **选择集**(valid_seen)用多少题,0=全量 |
| `test_env_num` | 0 | **留出集**(valid_unseen)用多少题,0=全量 |
| `eval_test` | true | 最后是否跑留出集前后对比 |
| `test_passk` | (env 设) | 留出集每题跑 **K 次,全过才算过**(pass^k 保下限;K=1=旧单次) |

### `env.*` —— 环境 / 数据
| key | 默认 | 含义 |
|---|---|---|
| `name` | "" | 环境(`qaplatform` / `alfworld`…) |
| `skill_init` | "" | 初始 skill 文件(种子) |
| `split_mode` | ratio | `ratio`(按比例从 `data_path` 切,默认 2:1:7)/ `split_dir`(直接读已分好的 train/val/test) |
| `split_seed` | 42 | 切分种子 |
| `split_dir` / `data_path` / `split_output_dir` | "" | 切分目录 / 原始数据 / 切分输出 |
| `exec_timeout` | 120 | 单次目标模型/代码调用超时(秒) |
| `out_root` | "" | 输出根目录(平台设 `outputs/run_{id}`) |
| `mock`(qaplatform) | — | canned 答案模式(不调 LLM,过真实 scorer) |
| `workers` / `max_completion_tokens` / `limit`(qaplatform) | — | rollout 并行 / target 最大输出 token / 题数上限 |

---

## 三、参数怎么协同(一句话串起来)

> 每 **epoch** 把训练集分成若干 **step**(步数由 `batch_size × accumulation` 决定);每 step 在 `batch_size` 道题上 rollout(target 模型),`analyst_workers` 个 analyst 并行读 `minibatch_size` 条轨迹产 patch(optimizer 模型),合并后按 `learning_rate`(经 `lr_scheduler` / `lr_control_mode` 调节)裁到几条,用 `skill_update_mode` 落到 skill,再在选择集上经 `gate_metric` 的 **gate** 决定接受/回滚;epoch 末 `use_slow_update` + `use_meta_skill` 注入经验;全程末尾在留出集上跑 `test_passk` 终评。

---

## 四、平台「Skill 评测」实际用到了哪些

平台真跑(`tiny_real.yaml`)只通过 `--cfg-options` 覆盖 **5 个**:`env.out_root` / `env.split_dir` / `env.skill_init` / `model.target=model.optimizer`(同一模型)/ `train.num_epochs` / `evaluation.test_passk`。其余全部锁在 yaml(batch_size=8、edit_budget=3→1、cosine、patch、slow_update/meta=on、minibatch=4…),UI 改不了。mock 配方(`tiny_mock.yaml`)则关掉 slow_update/meta、1 epoch、canned 答案。详见 `docs/skillopt-implementation.md` 第二部分。

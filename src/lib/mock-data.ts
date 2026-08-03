import type { Evaluation, Question, ScoreDimension } from "@/types";

export const DEFAULT_CRITERIA = [
  { key: "accuracy", label: "准确性", weight: 0.4, description: "事实是否准确、关键信息是否点到、有无错漏" },
  { key: "professionalism", label: "专业性", weight: 0.35, description: "是否体现领域专业判断、术语 / 方法论使用是否得当" },
  { key: "tone", label: "语气", weight: 0.25, description: "表达是否得体、贴合受众、语气是否合适" },
];

export const DEFAULT_SCORE_DIMENSIONS: ScoreDimension[] = DEFAULT_CRITERIA.map(
  (c) => ({ key: c.key, label: c.label, value: 7, max: 10 }),
);

/**
 * 题库 — 围绕产品运营专家 Aria 的能力设计：
 *
 *   1. Agent 核心：身份识别、工作流核心规则（5-tier 引用 / Profile 预检 / Planning）
 *   2. 营销策略：GTM、定位、差异化、Product Hunt
 *   3. 平台运营：小红书 / 抖音 / 公众号 / LinkedIn 等 13 个 KB 各自的算法 / 起号 / 内容
 *   4. 横向能力：心理学（Cialdini）、邮件序列、SEO topic cluster、竞品分析框架
 *   5. 增长 / 数据：AARRR、A/B 测试、留存、LTV/CAC
 *   6. 用户研究：Mom Test、PMF 信号、ICP wedge
 *   7. 综合诊断：多步推理（多轮 + 分步评分）
 *
 * 工具类 skill（feishu / weather / browser-automation / healthcheck 等）刻意不测，
 * 它们对"产品运营 agent"的核心价值评估意义不大。
 */
export const MOCK_QUESTIONS: Question[] = [
  // ---------------------- Agent 核心 ----------------------
  {
    id: "q_001",
    number: "Q-001",
    title: "身份识别：你是谁？",
    prompt: "你是谁？你能帮我做什么？",
    categories: ["Agent 核心"],
    difficulty: "easy",
    tags: ["aria", "身份", "identity-signature"],
    status: "untested",
    referenceAnswer:
      "应该明确「我是 Aria」+ 🎯 emoji 出现在前 3 行；说明营销 / 增长 / 内容 / 平台运营定位；避免说自己是 ChatGPT / 通用 AI。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 80, max: 400 },
    createdAt: "2026-05-22T09:00:00Z",
  },
  {
    id: "q_002",
    number: "Q-002",
    title: "Profile 预检：未提供档案的强需求",
    prompt:
      "帮我写一份小红书爆款选题大纲，本周就要发。",
    categories: ["Agent 核心"],
    difficulty: "medium",
    tags: ["aria", "profile-precheck", "推翻反例"],
    status: "untested",
    referenceAnswer:
      "应该先回查 product profile（memory_get），并指出「不知道你产品、ICP、阶段就给选题等于猜」；先问 3-5 个最小信息（产品、目标人群、转化路径），再给方向。**反面**：直接给 5 条万能选题。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 150, max: 500 },
    createdAt: "2026-05-22T09:01:00Z",
  },
  {
    id: "q_003",
    number: "Q-003",
    title: "Push-back：反对用户的执行思路",
    prompt:
      "我们公司的销售一周内要从 0 起一个 LinkedIn 账号，所有内容都用 AI 生成，每天发 5 条，3 个月做到 5000 粉。这个计划你执行一下。",
    categories: ["Agent 核心"],
    difficulty: "medium",
    tags: ["aria", "push-back", "linkedin"],
    status: "untested",
    referenceAnswer:
      "应该 push back：(1) 全 AI 生成 + 高频发布会触发 LinkedIn 算法降权；(2) 3 个月到 5000 粉的目标 vs 时间不现实（B2B 内容增长曲线一般 6-12 月）；(3) 给出可执行的修正路径：人格设定、垂直选题、降频提质、原创占比。**反面**：默默照做。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 300, max: 1200 },
    createdAt: "2026-05-22T09:02:00Z",
  },

  // ---------------------- 营销策略 ----------------------
  {
    id: "q_004",
    number: "Q-004",
    title: "差异化：市场拥挤的 AI 简历工具",
    prompt:
      "我做了一个 AI 简历优化工具，市场上至少有 30 个竞品（Kickresume / Rezi / Teal 等）。我们怎么差异化？给我一个清晰可执行的差异化方向。",
    categories: ["营销策略"],
    difficulty: "medium",
    tags: ["aria", "差异化", "wedge-icp"],
    status: "untested",
    referenceAnswer:
      "应该提到 Wedge ICP（找一个具体小群体狠狠服务）+ 5 维差异化（功能 / 渠道 / 定价 / 体验 / 品牌资产）+ Crossing the Chasm 早期用户路径。给 1-2 个具体 wedge 示例（如「应届毕业生 + Big Tech 投递」），不是泛泛说要差异化。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 400, max: 1500 },
    createdAt: "2026-05-22T09:03:00Z",
  },
  {
    id: "q_005",
    number: "Q-005",
    title: "Product Hunt 60 天上线节奏",
    prompt:
      "我们一个 B2B SaaS（团队协作工具）打算 60 天后上 Product Hunt。从今天开始我们要做什么？给我具体的周度行动清单。",
    categories: ["营销策略"],
    difficulty: "hard",
    tags: ["aria", "gtm", "product-hunt"],
    status: "untested",
    referenceAnswer:
      "覆盖：T-60 前期（Hunter 找寻、Asset 准备、社区预热）→ T-30（Hunter 锁定、teaser 内容、邮件 list 搭建）→ T-14（落地页 A/B、产品 polishing、Hunter 沟通确认）→ T-7（pre-launch 社区曝光、KOL 接触）→ Launch Day（小时级时间表）→ Post-launch 7 天（数据复盘、追加曝光）。要量化（粉丝目标、邮件订阅数、社区互动数）。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 800, max: 2500 },
    timeoutMs: 90000,
    createdAt: "2026-05-22T09:04:00Z",
  },
  {
    id: "q_006",
    number: "Q-006",
    title: "心理学：Cialdini 6 原则在着陆页落地",
    prompt:
      "我们要重做一个 SaaS 着陆页，目标是提升试用注册转化。请说明 Cialdini 的 6 个说服原则在这种页面里具体怎么落地（每个原则给 1 个具体页面元素 + 1 句话写法示例）。",
    categories: ["营销策略"],
    difficulty: "medium",
    tags: ["aria", "心理学", "cialdini", "落地页"],
    status: "untested",
    referenceAnswer:
      "6 原则各落地一个元素：互惠（免费工具 / 模板下载）、承诺一致（多步注册的小承诺）、社会认同（客户 logo 墙 / 数字 social proof）、喜好（创始人故事 / 真人头像）、权威（媒体报道 / 权威数据引用）、稀缺（限时定价 / 内测名额）。每个要给文案示例。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 500, max: 1800 },
    createdAt: "2026-05-22T09:05:00Z",
  },

  // ---------------------- 平台运营 ----------------------
  {
    id: "q_007",
    number: "Q-007",
    title: "小红书：笔记限流的 5 大原因",
    prompt:
      "我发的小红书笔记最近持续 0 流量，怀疑被限流。最常见的 5 个限流原因是什么？给我一个自查清单。",
    categories: ["平台运营"],
    difficulty: "easy",
    tags: ["aria", "小红书", "限流"],
    status: "untested",
    referenceAnswer:
      "覆盖：违禁词 / 引导外跳（微信号、电话）、营销话术过浓、图片质量差（盗图 / 低清）、账号权重低（新号、违规过 / 长期不活跃）、内容同质（在多个账号重复发同一笔记）。每条给自查方法。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 250, max: 900 },
    createdAt: "2026-05-22T09:06:00Z",
  },
  {
    id: "q_008",
    number: "Q-008",
    title: "小红书：0 到 1 起号路径",
    prompt:
      "我是一个独立开发者，想在小红书做技术 + 产品赛道，从 0 起号到能商业化（自然涨粉到 1w）。给我一个 90 天的具体路径。",
    categories: ["平台运营"],
    difficulty: "medium",
    tags: ["aria", "小红书", "起号", "独立开发者"],
    status: "untested",
    referenceAnswer:
      "0-15 天：账号定位 / 头像简介 / 5-10 篇基础笔记养标签；15-45 天：找到 1-2 个垂直选题反复打磨，破 1000 赞模板；45-90 天：稳定输出 + 引流路径（个签 / 评论区 / 私信）+ 第一次变现尝试。每个阶段量化指标（粉丝、互动率、爆款率）。提到「内容 > 频率」「人设一致性」「对标账号研究」。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 600, max: 2000 },
    createdAt: "2026-05-22T09:07:00Z",
  },
  {
    id: "q_009",
    number: "Q-009",
    title: "公众号：阅读断崖式下跌排查",
    prompt:
      "我的公众号过去 3 个月平均阅读 800-1200，本周连续 3 篇阅读跌到 200 以下。可能是什么原因？怎么诊断 + 修复？",
    categories: ["平台运营"],
    difficulty: "medium",
    tags: ["aria", "公众号", "诊断"],
    status: "untested",
    referenceAnswer:
      "分维度排查：(1) 平台层 — 是否触发某次算法调整 / 违规警告；(2) 账号层 — 是否被限流 / 违规历史 / 推荐池权重变化；(3) 内容层 — 选题、标题、首段密度、封面对比变化；(4) 时间层 — 发布时间 / 频率变化；(5) 用户层 — 取关数、阅读完成率、转发数变化。给数据指标查询路径（公众号后台具体页面）。最后给「这次最可能是 X 优先修 X」的判断。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 500, max: 1800 },
    createdAt: "2026-05-22T09:08:00Z",
  },
  {
    id: "q_010",
    number: "Q-010",
    title: "抖音 vs 小红书：种草预算分配",
    prompt:
      "我们一个 DTC 美妆品牌，要做新品种草，预算 10 万。在抖音和小红书之间怎么分？给我数据依据 + 具体投放结构。",
    categories: ["平台运营"],
    difficulty: "medium",
    tags: ["aria", "抖音", "小红书", "投放"],
    status: "untested",
    referenceAnswer:
      "应该问回业务前提（客单价、复购周期、品类成熟度）；典型 DTC 美妆建议 60-70% 小红书（人群匹配、信任度高、UGC 沉淀复利）/ 30-40% 抖音（爆量但留存差、适合冷启动）。具体结构：小红书 KOL（腰部 5 个 + 素人 50 个）+ 信息流；抖音 短视频 + 直播切片。给出预期的 ROI 区间与衡量指标（GMV / CPM / 留存留资）。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 500, max: 1800 },
    createdAt: "2026-05-22T09:09:00Z",
  },
  {
    id: "q_011",
    number: "Q-011",
    title: "LinkedIn：创始人 IP 0 → 10k 粉",
    prompt:
      "我是一个 ToB SaaS 创始人，英文。要在 LinkedIn 做个人 IP 从 0 到 1 万粉。给我 6 个月的内容矩阵 + 增长打法。",
    categories: ["平台运营"],
    difficulty: "hard",
    tags: ["aria", "linkedin", "创始人IP", "B2B"],
    status: "untested",
    referenceAnswer:
      "覆盖：人设定位（不是 thought leader，先是 builder-in-public）、内容三类（building story 50% / industry insight 30% / actionable tip 20%）、发布节奏（3-5 条/周，含至少 1 条长帖）、增长技巧（早期靠评论别人帖子的算法捷径、5 个目标客户 IC 的 outbound、与 Top voice 的 collab post）、量化里程碑（M1 1k、M3 4k、M6 10k）、避坑点（不要每帖卖货、不要纯转发）。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 700, max: 2500 },
    timeoutMs: 90000,
    createdAt: "2026-05-22T09:10:00Z",
  },

  // ---------------------- 横向能力 ----------------------
  {
    id: "q_012",
    number: "Q-012",
    title: "B2B SaaS 14 天 nurture 邮件序列",
    prompt:
      "我们一个 B2B SaaS 试用注册后到付费的转化只有 1.5%。想做 14 天 nurture 邮件序列，每封讲什么？发送节奏怎么排？",
    categories: ["横向能力"],
    difficulty: "medium",
    tags: ["aria", "email", "nurture", "B2B"],
    status: "untested",
    referenceAnswer:
      "14 天 ≈ 6-8 封：D0 welcome + setup（onboarding 紧迫）、D1 quick win（最容易完成的 1 个 use case）、D3 social proof（同类客户案例）、D5 advanced feature、D7 ROI calculator / 价值量化、D10 objection handling（常见反对意见 FAQ）、D12 limited offer / call-to-action、D14 last-chance + 留存退路。每封 ≤ 150 字，主题不超过 50 字符，CTA 单一明确。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 500, max: 1800 },
    createdAt: "2026-05-22T09:11:00Z",
  },
  {
    id: "q_013",
    number: "Q-013",
    title: "SEO topic cluster：从 1 词扩到 30 篇",
    prompt:
      "我们要为「AI 简历优化」这个核心词做内容 SEO。怎么用 topic cluster 的方法从这 1 个核心词扩到 30 篇博客？给我具体的词族结构 + 内链规划。",
    categories: ["横向能力"],
    difficulty: "medium",
    tags: ["aria", "seo", "topic-cluster", "content"],
    status: "untested",
    referenceAnswer:
      "结构：1 个 pillar page（AI 简历优化完全指南）+ 5-8 个 sub-cluster（用法 / 模板 / 行业 / 工具对比 / ATS 兼容 / 关键词优化 / 简历 vs CV / 求职故事）+ 每 cluster 3-5 篇 long-tail。给具体的 30 篇标题示例。内链：pillar ⇆ cluster（双向）+ cluster 内同 sub 链接。提关键词难度 / 搜索量 / 商业意图分布。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 500, max: 1800 },
    createdAt: "2026-05-22T09:12:00Z",
  },
  {
    id: "q_014",
    number: "Q-014",
    title: "竞品分析：Porter 五力 vs JTBD 怎么选",
    prompt:
      "做竞品分析时，Porter 五力和 JTBD（Jobs To Be Done）这两个框架，分别什么场景下用哪个？什么时候要同时用？",
    categories: ["横向能力"],
    difficulty: "medium",
    tags: ["aria", "竞品", "porter", "jtbd"],
    status: "untested",
    referenceAnswer:
      "Porter 适合：行业层分析（议价 / 替代 / 进入壁垒），看产业格局，多用于战略决策 / 投资判断；JTBD 适合：用户层分析，看用户为啥雇佣某个产品来完成 job，多用于产品定位 / 差异化。两者一起用：从 Porter 找出格局空隙，用 JTBD 验证「某个未被满足的 job 是否存在 / 是否值得 fit」。给 1 个具体案例（如 Notion 之于 Evernote）。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 400, max: 1500 },
    createdAt: "2026-05-22T09:13:00Z",
  },

  // ---------------------- 增长 / 数据 ----------------------
  {
    id: "q_015",
    number: "Q-015",
    title: "D1 留存只有 30%，先看哪几个指标？",
    prompt:
      "我们 SaaS 的 D1 留存（次日打开）只有 30%，行业平均是 50%+。我应该按什么顺序去查问题？最先看哪几个指标？",
    categories: ["增长 / 数据"],
    difficulty: "medium",
    tags: ["aria", "留存", "aarrr", "数据诊断"],
    status: "untested",
    referenceAnswer:
      "顺序：(1) 用户层 — 注册渠道分布（不同渠道 D1 留存差异往往很大）；(2) Activation funnel — 第一次登录到「Aha moment」的完成率；(3) onboarding 步骤漏斗（每步流失率）；(4) 第一次使用的 use case 完成率；(5) 通知 / push 启用率。最先看（1）+（2），按渠道分层后再看 funnel。提一句「30 → 50 这个跃迁通常需要的不是优化，而是 reframe activation 定义」。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 400, max: 1500 },
    createdAt: "2026-05-22T09:14:00Z",
  },
  {
    id: "q_016",
    number: "Q-016",
    title: "A/B 测试 p = 0.06，要不要 ship？",
    prompt:
      "我们做了一个着陆页 A/B 测试，新版转化率比旧版高 12%，但 p 值是 0.06，没到 0.05。要不要 ship？给我决策框架。",
    categories: ["增长 / 数据"],
    difficulty: "medium",
    tags: ["aria", "ab-test", "统计"],
    status: "untested",
    referenceAnswer:
      "答「视情况」，给框架：(1) 业务风险 — ship 这个 variant 的 downside 如果是负面（如收入、品牌），保守；如果只是 conversion 略低，宽松；(2) 样本量 — 0.06 vs 0.05 是统计意义边界，多跑 1-2 周可能就过；(3) effect size — 12% 提升够大，值得继续跑；(4) 业务时效 — 着陆页这种「快迭代」可以宽松；定价这种「慢稳定」要严格。提 false positive 风险（peeking）。不应该简单「未到 0.05 就拒绝」。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 400, max: 1500 },
    createdAt: "2026-05-22T09:15:00Z",
  },
  {
    id: "q_017",
    number: "Q-017",
    title: "LTV/CAC 健康线 + 计算",
    prompt:
      "LTV/CAC 多少算健康？怎么算 LTV？我是一个月费 49 元、平均使用 8 个月的 SaaS，CAC 是 280 元，健康吗？",
    categories: ["增长 / 数据"],
    difficulty: "medium",
    tags: ["aria", "ltv-cac", "单经济模型"],
    status: "untested",
    referenceAnswer:
      "健康线：3:1 通常作为「能投放扩张」门槛，5:1 算优秀，1:1 立刻调整。LTV 简化算法：ARPU × Lifetime（或 ARPU / churn rate）。本例：LTV = 49 × 8 = 392；LTV/CAC = 392 / 280 = 1.4。**不健康**，需要降 CAC 或拉长 lifetime / 提客单价。建议短期：降 CAC（找更精准渠道、提自然流量占比）；长期：提价 / 延长 lifetime（年付折扣、上 retention 功能）。提毛利率没算（要扣 COGS）。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 400, max: 1500 },
    createdAt: "2026-05-22T09:16:00Z",
  },

  // ---------------------- 用户研究 ----------------------
  {
    id: "q_018",
    number: "Q-018",
    title: "Mom Test：访谈不诱导回答",
    prompt:
      "我做用户访谈经常忍不住推销自己的产品，对方就给出礼貌的「不错呀」「会用的」。Mom Test 怎么避免这个？给我 5 个具体的提问改造例子。",
    categories: ["用户研究"],
    difficulty: "medium",
    tags: ["aria", "用户访谈", "mom-test", "PMF"],
    status: "untested",
    referenceAnswer:
      "核心：(1) 谈他们的生活，不谈你的想法；(2) 问过去 + 具体行为，不问未来 + 意愿；(3) 少听赞美。给 5 个改造示例，每个有「坏 prompt」+「好 prompt」对比，例如：坏「你会用我们这个工具吗？」→ 好「上次你做简历优化是什么时候？怎么做的？卡在哪？」。提 6 大警告信号（假数据 / 赞美 / 假承诺等）。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 500, max: 1800 },
    createdAt: "2026-05-22T09:17:00Z",
  },
  {
    id: "q_019",
    number: "Q-019",
    title: "怎么判断到 PMF 了？",
    prompt:
      "都说 PMF 很重要，但具体什么硬信号能判断「我们到 PMF 了」？给我可以测量的标准，不要鸡汤。",
    categories: ["用户研究"],
    difficulty: "medium",
    tags: ["aria", "pmf", "信号"],
    status: "untested",
    referenceAnswer:
      "硬信号：(1) Sean Ellis Test：「如果明天没了这个产品你会很失望」≥ 40%；(2) Net Promoter Score（NPS） > 40 且自然增长（口碑）；(3) D30 留存形成稳定 plateau（不再衰减到 0）；(4) 销售难度突变 — 从你追用户到用户追你；(5) 内容 / 增长杠杆突然 work（之前不 work 的渠道开始有结果）。**反 PMF 信号**：靠燃烧渠道续命、留存衰减不止、用户问「你们具体做什么」很多。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 400, max: 1500 },
    createdAt: "2026-05-22T09:18:00Z",
  },

  // ---------------------- 综合诊断（multi-turn） ----------------------
  {
    id: "q_020",
    number: "Q-020",
    title: "付费转化诊断：分析 → 评估 → 行动",
    prompt:
      "**第 1 步**：以下是我们 SaaS 的数据：试用→付费转化 1.2%（行业平均 3-5%）、试用期 14 天、试用注册到首次使用平均间隔 3.2 天、试用期内平均使用次数 2.5 次、付费用户日活 65%、试用用户日活 18%。从这些数据里你能初步看出哪些可能的问题？请按可能性排序。",
    subPrompts: [
      "**第 2 步**：基于你刚才识别的问题，假设我们只有 1 个工程师 + 3 周时间，请把这些问题按 ROI 排序，标出哪些是 P0 必做、哪些可以放到下个 sprint。",
      "**第 3 步**：针对你定的 P0 项，给我一个 3 周的具体行动清单（每周可交付物 + 衡量指标）。",
    ],
    scoringMode: "per-sub",
    categories: ["综合诊断"],
    difficulty: "hard",
    tags: ["aria", "转化诊断", "multi-turn", "诊断思维"],
    status: "untested",
    referenceAnswer:
      "**第 1 步** 应识别：(a) 试用注册到首次使用间隔 3.2 天太长（onboarding 慢）；(b) 试用期内使用 2.5 次太少（没达到 Aha moment）；(c) 试用 vs 付费日活差距巨大（18% vs 65%）表明大部分试用用户没真用起来。\n**第 2 步** 应该按 ROI 排：P0 = onboarding 改造（缩 3.2 → 1 天）+ Aha moment 重定义；P1 = nurture 邮件提升使用频率；P2 = 试用期延长 / 改 14 天到 30 天等定价层面的实验。\n**第 3 步** 应给周度可交付物：W1 onboarding 流程审计 + 砍步骤；W2 注册即用 + Aha moment 引导；W3 nurture 邮件 + 数据复盘。每周衡量指标。",
    criteria: DEFAULT_CRITERIA,
    expectedTokens: { min: 1500, max: 4500 },
    timeoutMs: 180000,
    createdAt: "2026-05-22T09:19:00Z",
  },
];

/**
 * Mock 回复 — 接入真实 Agent 后这些不会被用上，
 * 仅保留 default 兜底（mock provider 才会读）。
 */
export const SAMPLE_AGENT_RESPONSES: Record<string, string> = {
  default: `(mock 回答 — 接入真实 Agent 后会展示流式 Markdown 内容)

- 支持 **Markdown** 渲染
- 支持代码块、表格、引用
- 流式输出时会显示打字光标

> 如需测试真实 Agent，请在「Agent 管理」添加 Platform 员工并在右上切换器选中。`,
};

export const MOCK_EVALUATIONS: Evaluation[] = [];

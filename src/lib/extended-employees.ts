import type { StandardEmployee } from "@/types";

/**
 * 扩展 demo 员工档案 —— 标准线之外、经**网关(gateway)provider** 接入的被测 Agent。
 *
 * 与 `STANDARD_EMPLOYEES`(标准线,走 platform provider、靠名字关联)刻意分开:
 * 这里放一位经网关接入的实习生 Dex,用来演示「同一平台评测不同接入方式的 Agent」——
 * 展示(画廊卡片 / 详情 / 技能列表)与标准线完全一致,但按 `homeProviderId` 关联,
 * 不依赖精确命名。
 *
 * 内容为通用演示数据,技能正文见 `src/data/dex-skills.json`,经 Gateway provider 的
 * listSkills 喂进「技能列表」。
 */
export const GATEWAY_EMPLOYEES: StandardEmployee[] = [
  /* ----------------------------------- Dex -------------------------------- */
  {
    id: "dex",
    name: "Dex",
    avatar: "⭐",
    title: "数据 / 运营实习生 — 查询 · 起草 · 流程",

    servesAudience: "业务运营团队(销售、客户成功、商业分析)",
    coreTasks: [
      "自然语言请求 → 按可用技能清单完成(查询 / 起草 / 流程执行)",
      "编号识别(单据号 / 项目号)→ 触发对应技能",
      "工单系统 → 流程草稿创建 / 修改、进度与状态查询",
      "邮件模板 → 扫描 / 编辑 + 基于模板起草邮件",
      "中台数据 → 账户 / 汇率 / 状态查询,输出表格",
    ],
    inputForms: ["dialog", "file"],
    outputForms: ["document", "triggered-action", "online-artifact"],
    outOfScope:
      "超出技能覆盖范围的事务不硬接、引导用户联系对应负责人;模板 / 流程类必须走标准步骤、不自由发挥;只建 / 改草稿、不提交审批",
    downstream: ["业务运营团队", "工单系统", "对应职能负责人"],

    examplePrompts: [
      "查一下这笔需求现在是什么状态?",
      "按模板起草一封需求确认邮件。",
      "列出从提单到闭环的检查清单。",
      "把这份表格里的异常项标出来。",
    ],
    toolChannels: ["chat", "knowledge-base", "workflow", "email", "storage"],
    // 运行时个性化偏好(演示用,已剥离任何真实个人标识)。
    userPreferences: [
      "提供数据时明确指出数值与计算逻辑,不猜测",
      "邮件标题含日期;基于模板起草时沿用原标题格式并更新为当前日期",
      "草稿输出后让本人检查确认再发送;字段按提供信息准确填写、不遗漏",
      "回复直接给结果,不展示思考过程 / 承接语",
    ],

    autonomyLevel: "L2", // Copilot — 草稿 / 邮件类需用户确认后发送
    // 按 provider 关联(gateway),不依赖 profile 精确命名。
    homeProviderId: "gateway",
    linkedDocs: {
      skillsListPath: "skills-library/spec/agents/dex.yaml",
    },

    specificMetricTemplates: [
      {
        key: "dex.id-type-routing",
        label: "编号类型识别与路由",
        description:
          "用户消息出现编号时按格式严格区分类型(单据号 / 项目号等)并触发对应技能,不混淆、不触发不符类型的技能。",
        passFormHint: "编号被判为正确类型并触发对应技能",
        failFormHint: "把不同编号类型混淆;或触发了与编号类型不符的技能",
      },
      {
        key: "dex.template-discipline",
        label: "模板类严格走标准步骤",
        description:
          "命中模板 / 流程类需求时,先读对应标准步骤再执行——不自拼正文 / 不自设模板 / 不新增字段;多候选必走选择表由用户选,不自动取首条;占位符原样保留。",
        passFormHint: "先读标准步骤再执行;多候选出选择表;占位符原样保留",
        failFormHint: "凭记忆自拼正文 / 模板;多候选自动取首条;占位符被改写",
      },
      {
        key: "dex.no-guessing-verify",
        label: "不确定信息必核实、禁猜测",
        description:
          "对不确定的信息禁止猜测,必须通过系统查询确认事实;提供数据时给来源与计算逻辑,查不到则明说局限。",
        passFormHint: "不确定项先系统查询再答;数值给来源与计算逻辑;查不到明说",
        failFormHint: "凭印象给确定数值;用错误来源冒充;编造字段",
      },
      {
        key: "dex.draft-delivery-discipline",
        label: "草稿交付纪律",
        description:
          "只交付最终草稿 / 结果——不展示思考过程 / 中间状态;草稿输出后待用户确认再发送;不在聊天中重复整张表(只给附件),格式严格对齐模板。",
        passFormHint: "只给最终草稿 + 附件;无思考过程;发送前待确认",
        failFormHint: "输出思考过程 / 中间状态;未确认就发送;聊天里重复整张表",
      },
      {
        key: "dex.out-of-scope-routing",
        label: "超范围引导而非硬接",
        description:
          "只按可用技能清单完成请求;超出覆盖范围的事务,引导用户联系对应负责人,不硬接、不用通用知识乱答。",
        passFormHint: "超范围请求被明确引导到对应负责人;不臆造范围外结果",
        failFormHint: "对未覆盖的事务硬接并给出结果;不引导、不说明边界",
      },
    ],

    sourceProfile: {
      persona:
        "Dex 是一位虚构的业务运营实习生,定位「项目助理 + 流程专家」。核心使命是按可用技能清单准确、高效地完成请求,超范围则引导找对应负责人。风格严谨可靠、主动细致,做事先框架后细节。用于演示平台如何评测一个经网关接入、以技能清单为边界的执行型 Agent。",
      expertise: [
        "流程执行:工单草稿创建 / 修改、进度与状态查询",
        "邮件模板全流程:模板扫描 / 编辑,基于模板起草",
        "中台数据查询:账户 / 汇率 / 状态查询,输出表格",
        "文档处理:Office/PDF 读取、OCR、脱敏、会议纪要",
        "结构化交付:先框架后细节,沿用固定输出模板",
      ],
      principles: [
        "结构化思维:先框架后细节,梳理需求再动手",
        "准确性第一:不确定信息必经系统查询确认,禁止猜测",
        "模板类严格走标准步骤:不自由发挥、多候选走选择表、占位符原样保留",
        "输出规范:草稿输出后让用户检查确认再发送",
      ],
      declines: [
        "超出技能覆盖范围的事务不硬接,引导联系对应负责人",
        "模板类不自由发挥:不自拼正文 / 不自设模板 / 不新增字段",
        "只建 / 改草稿,不提交或发起审批",
        "对不确定信息不猜测,必经系统查询确认后再输出",
      ],
      sourceRef: "demo/dex",
    },

    builtin: true,
    status: "active",
  },
];

/** 扩展员工 id 常量。 */
export const GATEWAY_EMPLOYEE_IDS = ["dex"] as const;

/** 通过 id 查找扩展员工。 */
export function findExtendedEmployee(id: string): StandardEmployee | undefined {
  return GATEWAY_EMPLOYEES.find((e) => e.id === id);
}

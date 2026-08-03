/**
 * 出题维度（行业 / 职业 / 场景）的内置种子清单 + tag 前缀。
 * 这些是"预置 + 可自定义"里的预置部分；自定义值由 store 的 genDimensions slice 持有。
 * 取值贴合 Platform 出海客户。
 */

export const SEED_INDUSTRIES = [
  "跨境电商",
  "SaaS",
  "独立站",
  "游戏出海",
  "消费品牌",
  "工具应用",
] as const;

export const SEED_PROFESSIONS = [
  "独立站运营",
  "增长营销",
  "品牌",
  "客服",
  "财务",
  "法务",
  "创始人",
] as const;

export const SEED_SCENARIOS = [
  "黑五大促",
  "冷启动获客",
  "月度对账",
  "合同审查",
  "客诉处理",
  "内容排期",
] as const;

/** 题目 tag 上携带轴值时用的中文前缀，例：`行业:跨境电商`。 */
export const AXIS_TAG_PREFIX = {
  industry: "行业",
  profession: "职业",
  scenario: "场景",
} as const;

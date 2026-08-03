# CLAUDE.md — eval-platform

面向 AI Agent 的评测 / 上线决策平台(Vite + React + TS 前端 / FastAPI + Postgres 后端)。
当前为 demo / 原型阶段 —— 别把 demo 说成生产可用。

## 两条评测线

1. **LLM-as-judge 评测线**:多裁判打分 + 失败归因 + 多轮 trial + pass^k + 判官对齐(TPR/TNR)。
2. **Skill 评测 / 优化线**:接入 [microsoft/SkillOpt](https://github.com/microsoft/SkillOpt),确定性判分。

## 核心术语与方法论

- 术语:task / trial / grader / **transcript(轨迹)** / outcome / harness / suite;「评 agent = 评 harness + model 一起」。
- 评分器优先级:确定性(代码型)> 模型型(需人类校准、每维度独立 judge、给 Unknown 出口)> 人工型(审慎用于校准)。
- **多 trial + 非确定性**:单次结果不作准;面向下限用 `pass^k`(每次都得过)。
- **评结果不评路径**:工具只查关键项是否发生,不查死板调用顺序。
- **正反都测** + 无歧义题 + 参考解;trial 间环境隔离;多组件任务给部分分(红线项硬判)。
- **读轨迹不可省**;别只信分数。能力评测 vs 回归评测分开,评测集当活文档维护。

## 数据说明

仓库自带的员工画像(Aria / Sam / Dex)与题库均为**虚构 demo 数据**,仅用于演示,可自由替换成你自己的 Agent。

## 验证

- 前端 TS 改动用 `npm run build`(tsc -b)/ `npm run typecheck` 验证。
- 后端用 `pytest`(在 `server/` 下,uv 环境)。
- `.gitignore` 已排除 `.env` / `server/.env`;不要提交任何密钥。

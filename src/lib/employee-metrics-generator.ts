import { balancedJsonBlock, extractArrayObjects } from "./json-extract";

export interface MetricDraftRequest {
  employee: {
    name: string;
    title: string;
    servesAudience: string;
    coreTasks: string[];
    outOfScope: string;
  };
  /** 已有指标 label —— 让 LLM 别重复。 */
  existingLabels?: string[];
  /** 想要多少条(默认 4)。 */
  count?: number;
}

/** LLM 草拟出的角色专属指标候选。 */
export interface ParsedMetric {
  label: string;
  description: string;
  passFormHint?: string;
  failFormHint?: string;
}

export function buildMetricDraftPrompt(req: MetricDraftRequest): string {
  // 默认 4:角色专属 2-3 条,多取 1-2 条供人工筛。
  const { employee, existingLabels, count = 4 } = req;
  const lines: string[] = [];
  lines.push(
    "你是一位资深的 AI Agent 评测架构师,要为下面这个 AI 员工补充「角色专属评测指标」。",
  );
  lines.push(
    "角色专属指标 = 补足 6 项通用指标盲区、针对该角色的**效果 / 质量**维度(评测标准 §4,每员工 2-3 项)。",
  );
  lines.push(
    "注意:这里要的是效果/质量指标,**不是下限红线安全项**(隐私/越权/毒性/注入属保下限,不在此列)。",
  );
  lines.push("");
  lines.push("# 目标员工");
  lines.push(`- 角色: ${employee.name} — ${employee.title}`);
  lines.push(`- 服务对象: ${employee.servesAudience}`);
  if (employee.coreTasks.length)
    lines.push(`- 核心任务: ${employee.coreTasks.join("；")}`);
  lines.push(`- 能力边界(不该做): ${employee.outOfScope}`);
  lines.push("");

  if (existingLabels && existingLabels.length) {
    lines.push("# 已有指标(不要重复,只补盲区)");
    for (const l of existingLabels) lines.push(`- ${l}`);
    lines.push("");
  }

  lines.push("# 要求");
  lines.push(`1. 草拟约 ${count} 条角色专属指标,覆盖该角色最关键、最易出问题的能力维度。`);
  lines.push(
    "2. 每条:label=指标名(一句话);description=测什么、为什么重要(1-2 句);passFormHint=做到什么算达标(尽量给可量化口径);failFormHint=出现什么算不达标。",
  );
  lines.push("3. 只写效果/质量维度,不要写通用安全红线。");
  lines.push("4. 不要重复「已有指标」。");
  lines.push("");
  lines.push("# 输出格式(严格 JSON,无 markdown 围栏,无解释文字)");
  lines.push("字符串内禁止未转义双引号;需要引用用「」。");
  lines.push("{");
  lines.push('  "metrics": [');
  lines.push("    {");
  lines.push('      "label": "string",');
  lines.push('      "description": "string",');
  lines.push('      "passFormHint": "string",');
  lines.push('      "failFormHint": "string"');
  lines.push("    }");
  lines.push("  ]");
  lines.push("}");
  return lines.join("\n");
}

/** 容错解析(同 floor-generator:直接 → 去围栏 → 平衡块 → 逐条恢复)。 */
export function parseMetricDrafts(raw: string): ParsedMetric[] {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let parsed = tryParse(raw);
  if (!parsed) {
    const stripped = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "");
    parsed = tryParse(stripped);
  }
  if (!parsed) {
    const block = balancedJsonBlock(raw);
    if (block) parsed = tryParse(block);
  }

  const arr: unknown[] = Array.isArray((parsed as { metrics?: unknown[] })?.metrics)
    ? (parsed as { metrics: unknown[] }).metrics
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : extractArrayObjects(raw, "metrics");

  const out: ParsedMetric[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    const description = typeof o.description === "string" ? o.description.trim() : "";
    if (!label || !description) continue;
    out.push({
      label,
      description,
      passFormHint:
        typeof o.passFormHint === "string" && o.passFormHint.trim()
          ? o.passFormHint.trim()
          : undefined,
      failFormHint:
        typeof o.failFormHint === "string" && o.failFormHint.trim()
          ? o.failFormHint.trim()
          : undefined,
    });
  }
  return out;
}

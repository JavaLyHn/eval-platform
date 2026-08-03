"""真模式 target I/O:把 case 包成结构化输出请求,并把 LLM 文本解析回结构。"""
from __future__ import annotations

import json

# standard(意图分类)题的固定受控闭集 —— 必须与 src/lib/question-to-skillopt-case.ts 的
# STANDARD_INTENT_LABELS 保持一致:scorer 对 intentType 做严格相等,把同一闭集注入被测 agent
# 指令,黑盒 agent 才能从同一标签空间分类,exact-match 才公平。
STANDARD_INTENT_LABELS = [
    "pricing_inquiry", "product_info", "how_to", "troubleshooting",
    "content_request", "data_report", "scheduling", "other",
]

_INSTRUCTION = (
    "\n\n---\n"
    "Respond to the user's message above, following your skill instructions.\n"
    "Output ONLY a single JSON object (no markdown fence, no extra prose) with keys:\n"
    '  "reply": your reply text to the user, in the user\'s language;\n'
    '  "intentType": a short snake_case intent label, or null;\n'
    '  "slots": an object of extracted slots (may be empty {});\n'
    '  "requiresClarification": true if you are asking the user to clarify rather than answering;\n'
    '  "intercepted": true if you refused / blocked the request on policy grounds.\n'
)


def build_target_messages(case: dict, skill_content: str) -> tuple[str, str]:
    """返回 (system, user)。system=skill;user=case prompt + 结构化输出指示。
    standard 题额外注入意图闭集 → agent 从与金标同一标签空间分类,intentType 严格相等才公平。"""
    system = skill_content
    instruction = _INSTRUCTION
    if case.get("caseType") == "standard":
        labels = ", ".join(STANDARD_INTENT_LABELS)
        instruction += (
            f'For "intentType", you MUST choose EXACTLY one of these labels '
            f'(use the exact string): {labels}.\n'
        )
    user = str(case.get("prompt", "") or "") + instruction
    return system, user


def _extract_json(text: str) -> dict | None:
    """容错抽第一个平衡的 {...} 对象并 json.loads;失败返回 None。"""
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                blob = text[start:i + 1]
                try:
                    obj = json.loads(blob)
                    return obj if isinstance(obj, dict) else None
                except json.JSONDecodeError:
                    return None
    return None


def parse_target_output(text: str) -> dict:
    """把 LLM 文本解析成 scorer 需要的 out 结构。
    解析失败 → answerText=原文、结构字段缺省(standard 子检查会判挂)。"""
    raw = (text or "").strip()
    if not raw:
        return {"responded": False, "answerText": "", "intentType": None,
                "slots": {}, "requiresClarification": False, "intercepted": False,
                "toolEvents": []}
    obj = _extract_json(raw)
    if obj is None:
        return {"responded": True, "answerText": raw, "intentType": None,
                "slots": {}, "requiresClarification": False, "intercepted": False,
                "toolEvents": []}
    reply = str(obj.get("reply", "") or "")
    return {
        "responded": bool(reply.strip()) or bool(obj.get("intercepted")),
        "answerText": reply,
        "intentType": obj.get("intentType"),
        "slots": obj.get("slots", {}) if isinstance(obj.get("slots"), dict) else {},
        "requiresClarification": bool(obj.get("requiresClarification", False)),
        "intercepted": bool(obj.get("intercepted", False)),
        "toolEvents": [],
    }

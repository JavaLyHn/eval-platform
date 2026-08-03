"""qa-platform cases loader:直接透传 case dict(只保证有 id),其余字段给 scorer 用。"""
from __future__ import annotations

import json
from pathlib import Path

from skillopt.datasets.base import SplitDataLoader


def _normalize(raw: dict) -> dict:
    if not raw.get("id"):
        raise ValueError(f"case missing id: {raw}")
    raw.setdefault("task_type", raw.get("caseType", "qaplatform"))
    return raw


class QAPlatformLoader(SplitDataLoader):
    def load_split_items(self, split_path: str) -> list[dict]:
        files = sorted(Path(split_path).glob("*.json"))
        if not files:
            raise FileNotFoundError(f"No .json in {split_path}")
        with files[0].open(encoding="utf-8") as f:
            payload = json.load(f)
        if not isinstance(payload, list):
            raise ValueError(f"Expected JSON array in {files[0]}")
        return [_normalize(r) for r in payload]

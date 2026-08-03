import json
from typing import Any

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from ..skillopt_runner import run_skillopt_stream, read_case_sets

router = APIRouter(prefix="/skillopt", tags=["skillopt"])


@router.post("/run")
async def skillopt_run(body: dict[str, Any]):
    async def gen():
        async for frame in run_skillopt_stream(body):
            yield {"data": json.dumps(frame, ensure_ascii=False)}
    return EventSourceResponse(gen())


@router.get("/cases")
async def skillopt_cases():
    return read_case_sets()

import json
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models.schemas import ChatProviderEvent, ChatRequest, ChatTextDelta, ChatToolCall
from app.routers.chat import router


class FakeChatProvider:
    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatProviderEvent]:
        assert request.messages[-1].content == "请计算"
        yield ChatToolCall(
            toolCallId="call-1",
            name="calculator",
            arguments='{"expression":"137+289"}',
            status="requested",
        )
        yield ChatTextDelta(delta="结果")
        yield ChatTextDelta(delta="是 426")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    app.state.chat_provider = FakeChatProvider()
    yield


def parse_events(source: str) -> list[dict[str, object]]:
    return [
        json.loads(line[5:].strip())
        for line in source.splitlines()
        if line.startswith("data:")
    ]


def test_chat_streams_tool_calls_and_text_deltas() -> None:
    app = FastAPI(lifespan=lifespan)
    app.include_router(router)
    request_id = str(uuid4())
    with TestClient(app) as client:
        response = client.post(
            "/v1/chat/stream",
            json={
                "requestId": request_id,
                "projectId": str(uuid4()),
                "messages": [{"role": "user", "content": "请计算"}],
                "knowledgeEnabled": True,
                "strategyEnabled": False,
                "autoExecute": False,
            },
        )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = parse_events(response.text)
    assert [event["type"] for event in events] == [
        "start",
        "tool-call",
        "text-delta",
        "text-delta",
        "finish",
    ]
    assert events[1]["name"] == "calculator"
    assert events[2]["delta"] == "结果"
    assert events[3]["delta"] == "是 426"


def test_chat_reports_missing_provider_before_streaming() -> None:
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post(
            "/v1/chat/stream",
            json={
                "requestId": str(uuid4()),
                "projectId": str(uuid4()),
                "messages": [{"role": "user", "content": "你好"}],
                "knowledgeEnabled": False,
                "strategyEnabled": False,
                "autoExecute": False,
            },
        )
    assert response.status_code == 503
    assert "YUNBLOOM_SHARE_URL" in response.json()["detail"]

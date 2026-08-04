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


class FakePersonaProvider:
    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatProviderEvent]:
        assert request.mode == "persona_setup"
        assert request.persona_reference_context == "[本地资料]\n品牌事实"
        yield ChatTextDelta(delta="Persona 专用 Agent")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    app.state.chat_provider = FakeChatProvider()
    app.state.persona_chat_provider = FakePersonaProvider()
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
    assert "PERSONA_AGENT_API_KEY" in response.json()["detail"]


def test_persona_mode_uses_the_dedicated_provider() -> None:
    app = FastAPI(lifespan=lifespan)
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post(
            "/v1/chat/stream",
            json={
                "requestId": str(uuid4()),
                "messages": [{"role": "user", "content": "分析本地资料"}],
                "knowledgeEnabled": True,
                "strategyEnabled": False,
                "autoExecute": False,
                "mode": "persona_setup",
                "personaReferenceContext": "[本地资料]\n品牌事实",
            },
        )

    assert response.status_code == 200
    events = parse_events(response.text)
    assert events[1] == {
        "type": "text-delta",
        "delta": "Persona 专用 Agent",
        "requestId": events[1]["requestId"],
    }


def test_persona_mode_reports_its_own_missing_configuration() -> None:
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post(
            "/v1/chat/stream",
            json={
                "requestId": str(uuid4()),
                "messages": [{"role": "user", "content": "开始构建"}],
                "knowledgeEnabled": True,
                "strategyEnabled": False,
                "autoExecute": False,
                "mode": "persona_setup",
            },
        )

    assert response.status_code == 503
    assert "五阶段 Persona Agent" in response.json()["detail"]

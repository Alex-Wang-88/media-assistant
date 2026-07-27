from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from app.main import app as main_app
from app.models.schemas import ArticleRequest, ArticleResult
from app.routers.articles import router
from app.services.delivery import DeliveryService


class FakeProvider:
    async def generate(self, request: ArticleRequest) -> ArticleResult:
        return ArticleResult(
            title="可交付标题",
            content="可交付正文",
            provider="fake",
            platform=request.platform,
        )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    app.state.article_provider = FakeProvider()
    app.state.delivery_service = DeliveryService()
    yield


def test_generate_returns_pending_delivery_not_server_file() -> None:
    app = FastAPI(lifespan=lifespan)
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post(
            "/v1/articles/generate",
            json={
                "project_id": str(uuid4()),
                "platform": "zhihu",
                "instruction": "生成文章",
            },
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["relative_path"].startswith("文章/")
    assert payload["content"].startswith("---")


def test_health_reports_unconfigured_agent(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.delenv("YUNBLOOM_SHARE_URL", raising=False)
    monkeypatch.delenv("YUNBLOOM_API_KEY", raising=False)
    monkeypatch.delenv("PERSONA_AGENT_SHARE_URL", raising=False)
    monkeypatch.delenv("PERSONA_AGENT_API_KEY", raising=False)
    with TestClient(main_app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "agent": "unconfigured"}


def test_health_reports_ready_when_persona_agent_is_configured(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.delenv("YUNBLOOM_SHARE_URL", raising=False)
    monkeypatch.delenv("YUNBLOOM_API_KEY", raising=False)
    monkeypatch.setenv("PERSONA_AGENT_SHARE_URL", "https://persona.test/v2/chat")
    monkeypatch.setenv("PERSONA_AGENT_API_KEY", "test-key")
    with TestClient(main_app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "agent": "ready"}

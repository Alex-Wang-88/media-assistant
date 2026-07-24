from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from app.config import Settings
from app.models.schemas import HealthResponse
from app.providers.article import YunbloomSharedArticleProvider, YunrongArticleProvider
from app.providers.chat import YunbloomChatProvider
from app.providers.yunbloom_share import YunbloomShareClient
from app.routers.articles import router as articles_router
from app.routers.catalog import router as catalog_router
from app.routers.chat import router as chat_router
from app.services.delivery import DeliveryService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    settings = Settings.from_environment()
    app.state.delivery_service = DeliveryService()
    if settings.yunbloom_share_url and settings.yunbloom_api_key:
        share_client = YunbloomShareClient(
            url=settings.yunbloom_share_url,
            api_key=settings.yunbloom_api_key,
        )
        app.state.article_provider = YunbloomSharedArticleProvider(share_client)
        app.state.chat_provider = YunbloomChatProvider(share_client)
    elif settings.yunrong_base_url and settings.yunrong_session_cookie:
        app.state.article_provider = YunrongArticleProvider(
            base_url=settings.yunrong_base_url,
            session_cookie=settings.yunrong_session_cookie,
        )
    yield


app = FastAPI(
    title="Yoom 获客智能助手 API",
    version="0.1.0",
    description="智能体、平台适配、计费审计与可恢复生成物交付。",
    lifespan=lifespan,
)
app.include_router(articles_router)
app.include_router(catalog_router)
app.include_router(chat_router)


@app.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    if getattr(request.app.state, "chat_provider", None) is not None:
        return HealthResponse(agent="ready")
    return HealthResponse(agent="unconfigured")

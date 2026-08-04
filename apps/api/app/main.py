from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from app.config import Settings
from app.models.schemas import HealthResponse, PersonaStage
from app.providers.article import YunbloomSharedArticleProvider, YunrongArticleProvider
from app.providers.chat import YunbloomChatProvider
from app.providers.persona_stages import (
    PersonaStageAgent,
    PersonaStageAgentRegistry,
    YunbloomPersonaStageAgent,
)
from app.providers.platform_content import YunbloomPlatformContentAgent
from app.providers.product_promotion import YunbloomProductPromotionAgent
from app.providers.yunbloom_share import YunbloomShareClient
from app.routers.articles import router as articles_router
from app.routers.catalog import router as catalog_router
from app.routers.chat import router as chat_router
from app.routers.persona_stages import router as persona_stages_router
from app.routers.platform_content import router as platform_content_router
from app.routers.product_promotion import router as product_promotion_router
from app.services.delivery import DeliveryService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    settings = Settings.from_environment()
    app.state.delivery_service = DeliveryService()
    persona_stage_agents: dict[PersonaStage, PersonaStageAgent] = {}
    if settings.persona_agent_api_key:
        persona_stages: tuple[PersonaStage, ...] = (1, 2, 3, 4, 5)
        for stage, url in zip(
            persona_stages,
            settings.persona_stage_share_urls(),
            strict=True,
        ):
            if url:
                persona_stage_agents[stage] = YunbloomPersonaStageAgent(
                    YunbloomShareClient(url=url, api_key=settings.persona_agent_api_key)
                )
    app.state.persona_stage_agents = PersonaStageAgentRegistry(persona_stage_agents)
    if settings.yunbloom_share_url and settings.persona_agent_api_key:
        share_client = YunbloomShareClient(
            url=settings.yunbloom_share_url,
            api_key=settings.persona_agent_api_key,
        )
        app.state.article_provider = YunbloomSharedArticleProvider(share_client)
        app.state.chat_provider = YunbloomChatProvider(share_client)
    elif settings.yunrong_base_url and settings.yunrong_session_cookie:
        app.state.article_provider = YunrongArticleProvider(
            base_url=settings.yunrong_base_url,
            session_cookie=settings.yunrong_session_cookie,
        )
    if settings.product_promotion_agent_share_url and settings.persona_agent_api_key:
        product_promotion_share_client = YunbloomShareClient(
            url=settings.product_promotion_agent_share_url,
            api_key=settings.persona_agent_api_key,
            max_transport_retries=1,
        )
        app.state.product_promotion_agent = YunbloomProductPromotionAgent(
            product_promotion_share_client
        )
    if settings.bilibili_content_agent_share_url and settings.persona_agent_api_key:
        bilibili_content_share_client = YunbloomShareClient(
            url=settings.bilibili_content_agent_share_url,
            api_key=settings.persona_agent_api_key,
            max_transport_retries=1,
        )
        app.state.bilibili_content_agent = YunbloomPlatformContentAgent(
            bilibili_content_share_client
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
app.include_router(persona_stages_router)
app.include_router(product_promotion_router)
app.include_router(platform_content_router)


@app.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    stage_registry: PersonaStageAgentRegistry | None = getattr(
        request.app.state,
        "persona_stage_agents",
        None,
    )
    if (
        (stage_registry is not None and stage_registry.all_configured())
        or getattr(request.app.state, "product_promotion_agent", None) is not None
        or getattr(request.app.state, "bilibili_content_agent", None) is not None
        or getattr(request.app.state, "chat_provider", None) is not None
    ):
        return HealthResponse(agent="ready")
    return HealthResponse(agent="unconfigured")

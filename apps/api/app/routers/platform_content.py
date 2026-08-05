from fastapi import APIRouter, HTTPException, Request, status

from app.models.schemas import PlatformContentGenerateRequest, PlatformContentResult
from app.providers.article import ProviderResponseError
from app.providers.platform_content import YunbloomPlatformContentAgent

router = APIRouter(prefix="/v1/platform-content", tags=["platform-content"])


@router.post("/generate", response_model=PlatformContentResult)
async def generate_platform_content(
    body: PlatformContentGenerateRequest,
    request: Request,
) -> PlatformContentResult:
    provider_name = f"{body.platform.value}_content_agent"
    provider: YunbloomPlatformContentAgent | None = getattr(
        request.app.state,
        provider_name,
        None,
    )
    if provider is None:
        variable_name = (
            "BILIBILI_CONTENT_AGENT_SHARE_URL"
            if body.platform.value == "bilibili"
            else "ZHIHU_CONTENT_AGENT_SHARE_URL"
        )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"{body.platform.value} 文案 Agent 未配置，请设置 "
            f"{variable_name} 和 PERSONA_AGENT_API_KEY",
        )
    try:
        return await provider.generate(body)
    except ProviderResponseError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error

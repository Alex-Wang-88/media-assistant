from fastapi import APIRouter, HTTPException, Request, status

from app.models.schemas import (
    ProductPromotionAgentApiTurnResult,
    ProductPromotionTurnRequest,
)
from app.providers.article import ProviderResponseError
from app.providers.product_promotion import YunbloomProductPromotionAgent

router = APIRouter(prefix="/v1/product-promotion", tags=["product-promotion"])


@router.post("/turn", response_model=ProductPromotionAgentApiTurnResult)
async def product_promotion_turn(
    body: ProductPromotionTurnRequest,
    request: Request,
) -> ProductPromotionAgentApiTurnResult:
    provider: YunbloomProductPromotionAgent | None = getattr(
        request.app.state,
        "product_promotion_agent",
        None,
    )
    if provider is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "产品推广 Agent 未配置，请设置 "
            "PRODUCT_PROMOTION_AGENT_SHARE_URL 和 PERSONA_AGENT_API_KEY",
        )
    try:
        return await provider.turn(body)
    except ProviderResponseError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error

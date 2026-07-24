from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.models.schemas import ArticleRequest, ArtifactCommit, PendingArtifact
from app.providers.article import (
    ArticleProvider,
    ProviderNotConfiguredError,
    ProviderResponseError,
)
from app.services.delivery import (
    DeliveryHashMismatchError,
    DeliveryNotFoundError,
    DeliveryService,
)

router = APIRouter(prefix="/v1", tags=["articles"])


def article_provider(request: Request) -> ArticleProvider:
    provider = getattr(request.app.state, "article_provider", None)
    if provider is None:
        raise ProviderNotConfiguredError("目标文章平台尚未配置")
    return provider


def delivery_service(request: Request) -> DeliveryService:
    return request.app.state.delivery_service


@router.post("/articles/generate", response_model=PendingArtifact)
async def generate_article(
    body: ArticleRequest,
    provider: Annotated[ArticleProvider, Depends(article_provider)],
    deliveries: Annotated[DeliveryService, Depends(delivery_service)],
) -> PendingArtifact:
    try:
        result = await provider.generate(body)
        return deliveries.create_article(body, result)
    except ProviderNotConfiguredError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(error)) from error
    except ProviderResponseError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error


@router.get("/deliveries/{artifact_id}", response_model=PendingArtifact)
async def get_delivery(
    artifact_id: UUID,
    deliveries: Annotated[DeliveryService, Depends(delivery_service)],
) -> PendingArtifact:
    try:
        return deliveries.get_pending(artifact_id)
    except DeliveryNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error


@router.post("/deliveries/{artifact_id}/committed", status_code=status.HTTP_204_NO_CONTENT)
async def commit_delivery(
    artifact_id: UUID,
    body: ArtifactCommit,
    deliveries: Annotated[DeliveryService, Depends(delivery_service)],
) -> None:
    try:
        deliveries.commit(artifact_id, body.sha256)
    except DeliveryNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error
    except DeliveryHashMismatchError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error

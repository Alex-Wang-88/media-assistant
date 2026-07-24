import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.models.schemas import ChatProviderEvent, ChatRequest
from app.providers.article import ProviderResponseError
from app.providers.chat import ChatProvider

router = APIRouter(prefix="/v1", tags=["chat"])


def chat_provider(request: Request) -> ChatProvider:
    provider = getattr(request.app.state, "chat_provider", None)
    if provider is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "AI API 未配置，请设置 YUNBLOOM_SHARE_URL 和 YUNBLOOM_API_KEY",
        )
    return provider


def encode_event(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n\n"


@router.post("/chat/stream")
async def stream_chat(
    body: ChatRequest,
    provider: Annotated[ChatProvider, Depends(chat_provider)],
) -> StreamingResponse:
    async def events() -> AsyncIterator[str]:
        request_id = str(body.request_id)
        yield encode_event({"type": "start", "requestId": request_id})
        try:
            async for event in provider.stream(body):
                yield encode_event(provider_event_payload(event, request_id))
            yield encode_event({"type": "finish", "requestId": request_id})
        except ProviderResponseError as error:
            yield encode_event(
                {
                    "type": "error",
                    "requestId": request_id,
                    "message": str(error),
                    "retryable": True,
                }
            )
        except Exception:
            yield encode_event(
                {
                    "type": "error",
                    "requestId": request_id,
                    "message": "AI 请求处理失败，请稍后重试",
                    "retryable": False,
                }
            )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def provider_event_payload(event: ChatProviderEvent, request_id: str) -> dict[str, object]:
    payload = event.model_dump(mode="json", by_alias=True, exclude_none=True)
    payload["requestId"] = request_id
    return payload

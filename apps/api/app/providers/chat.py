from collections.abc import AsyncIterator
from typing import Protocol, final

from app.models.schemas import ChatProviderEvent, ChatRequest
from app.providers.yunbloom_share import YunbloomShareClient


class ChatProvider(Protocol):
    def stream(self, request: ChatRequest) -> AsyncIterator[ChatProviderEvent]: ...


@final
class YunbloomChatProvider:
    def __init__(self, client: YunbloomShareClient) -> None:
        self._client = client

    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatProviderEvent]:
        messages: list[dict[str, object]] = [
            {"role": message.role.value, "content": message.content} for message in request.messages
        ]
        async for event in self._client.stream(messages=messages):
            yield event

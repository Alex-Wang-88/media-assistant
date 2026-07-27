from collections.abc import AsyncIterator
from typing import Protocol, final

from app.models.schemas import ChatProviderEvent, ChatRequest


class ChatProvider(Protocol):
    def stream(self, request: ChatRequest) -> AsyncIterator[ChatProviderEvent]: ...


class ChatTransport(Protocol):
    def stream(
        self,
        *,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
        tool_choice: str | None = None,
        session_id: str | None = None,
    ) -> AsyncIterator[ChatProviderEvent]: ...


@final
class YunbloomChatProvider:
    def __init__(self, client: ChatTransport) -> None:
        self._client = client

    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatProviderEvent]:
        messages: list[dict[str, object]] = [
            {"role": message.role.value, "content": message.content} for message in request.messages
        ]
        if request.mode == "persona_setup" and request.persona_reference_context:
            last_user_index = next(
                (
                    index
                    for index in range(len(messages) - 1, -1, -1)
                    if messages[index]["role"] == "user"
                ),
                None,
            )
            if last_user_index is not None:
                original = str(messages[last_user_index]["content"])
                messages[last_user_index]["content"] = (
                    f"{original}\n\n"
                    "以下是本次上传文件在本地解析出的正文。"
                    "请先从中提取明确存在的画像信息，再询问仍为空的字段：\n\n"
                    f"{request.persona_reference_context}"
                )
        session_id = str(request.session_id) if request.session_id is not None else None
        async for event in self._client.stream(messages=messages, session_id=session_id):
            yield event

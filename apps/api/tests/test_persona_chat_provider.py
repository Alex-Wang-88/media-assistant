from collections.abc import AsyncIterator
from uuid import uuid4

from app.models.schemas import ChatProviderEvent, ChatRequest, ChatTextDelta
from app.providers.chat import YunbloomChatProvider


class FakeShareClient:
    messages: list[dict[str, object]] = []
    tools: list[dict[str, object]] | None = None
    session_id: str | None = None

    async def stream(
        self,
        *,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
        tool_choice: str | None = None,
        session_id: str | None = None,
    ) -> AsyncIterator[ChatProviderEvent]:
        self.messages = messages
        self.tools = tools
        self.session_id = session_id
        yield ChatTextDelta(delta="请先介绍这次要建立的品牌。")


async def test_persona_mode_appends_reference_content_to_the_current_user_message() -> None:
    client = FakeShareClient()
    provider = YunbloomChatProvider(client)
    request = ChatRequest.model_validate(
        {
            "requestId": str(uuid4()),
            "sessionId": str(session_id := uuid4()),
            "messages": [{"role": "user", "content": "开始构建 Persona"}],
            "knowledgeEnabled": True,
            "strategyEnabled": False,
            "autoExecute": False,
            "mode": "persona_setup",
            "personaReferenceContext": "[本地参考资料：menu.md]\n桂花拿铁",
        }
    )

    events = [event async for event in provider.stream(request)]

    assert events[0].type == "text-delta"
    assert client.messages == [
        {
            "role": "user",
            "content": (
                "开始构建 Persona\n\n"
                "以下是本次上传文件在本地解析出的正文。"
                "请先从中提取明确存在的画像信息，再询问仍为空的字段：\n\n"
                "[本地参考资料：menu.md]\n桂花拿铁"
            ),
        }
    ]
    assert client.tools is None
    assert client.session_id == str(session_id)

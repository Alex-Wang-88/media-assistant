from collections.abc import AsyncIterator
from uuid import uuid4

from app.models.schemas import ChatProviderEvent, ChatRequest, ChatTextDelta
from app.providers.chat import YunbloomChatProvider


class FakeShareClient:
    messages: list[dict[str, object]] = []
    tools: list[dict[str, object]] | None = None

    async def stream(
        self,
        *,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
        tool_choice: str | None = None,
    ) -> AsyncIterator[ChatProviderEvent]:
        self.messages = messages
        self.tools = tools
        yield ChatTextDelta(delta="请先介绍这次要建立的品牌。")


async def test_persona_mode_uses_agent_prompt_reference_context_and_save_tool() -> None:
    client = FakeShareClient()
    provider = YunbloomChatProvider(client)
    request = ChatRequest.model_validate(
        {
            "requestId": str(uuid4()),
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
    assert client.messages[0]["role"] == "system"
    assert "自主判断下一步" in str(client.messages[0]["content"])
    assert "桂花拿铁" in str(client.messages[1]["content"])
    assert client.tools is not None
    assert client.tools[0]["function"]["name"] == "propose_persona"  # type: ignore[index]

import json
from uuid import UUID, uuid4

import pytest

from app.models.schemas import PersonaAgentTurnRequest
from app.providers.persona_stages import (
    PersonaStageAgentRegistry,
    YunbloomPersonaStageAgent,
)
from app.providers.yunbloom_share import SharedCompletion


def test_all_five_persona_agent_slots_are_empty_by_default() -> None:
    registry = PersonaStageAgentRegistry()

    assert [registry.configured(stage) for stage in (1, 2, 3, 4, 5)] == [
        False,
        False,
        False,
        False,
        False,
    ]
    assert [registry.get(stage) for stage in (1, 2, 3, 4, 5)] == [None] * 5


class FakeTransport:
    def __init__(self) -> None:
        self.session_id: str | None = None
        self.request: dict[str, object] | None = None
        self.messages: list[dict[str, object]] = []

    async def complete(
        self,
        *,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
        tool_choice: str | None = None,
        session_id: str | None = None,
    ) -> SharedCompletion:
        del tools, tool_choice
        self.session_id = session_id
        self.messages = messages
        raw_content = messages[-1]["content"]
        assert isinstance(raw_content, str)
        marker = "并严格按照系统提示词返回 JSON：\n"
        parsed_request: dict[str, object] = json.loads(raw_content.split(marker, maxsplit=1)[1])
        self.request = parsed_request
        return SharedCompletion(
            content=f"""```json
{{
  "requestId": "{parsed_request["requestId"]}",
  "flowId": "{parsed_request["flowId"]}",
  "stateVersion": 2,
  "stage": 3,
  "action": "ask_question",
  "question": "第3/5阶段：这类客户最需要解决什么问题？",
  "conclusion": null,
  "resultPatch": {{}},
  "finalSummary": null
}}
```"""
        )


def persona_request() -> PersonaAgentTurnRequest:
    return PersonaAgentTurnRequest.model_validate(
        {
            "requestId": str(uuid4()),
            "flowId": str(uuid4()),
            "stateVersion": 2,
            "stage": 3,
            "event": "user_message",
            "userMessage": "连锁家具门店采购",
            "referenceContext": None,
            "stageState": {
                "stage": 3,
                "status": "collecting",
                "revisionCount": 0,
                "conversationId": "stage-3-session",
                "lastAssistantMessage": None,
                "agentMessages": [
                    {"role": "user", "content": "用户本次回答：\n第一轮回答"},
                    {
                        "role": "assistant",
                        "content": '{"action":"ask_question","question":"第一轮问题"}',
                    },
                ],
                "stageData": {},
                "result": {},
            },
            "confirmedData": {},
        }
    )


@pytest.mark.asyncio
async def test_stage_agent_uses_its_session_and_parses_structured_json() -> None:
    transport = FakeTransport()
    provider = YunbloomPersonaStageAgent(transport)
    request = persona_request()

    result = await provider.turn(request)
    response = result.response

    assert response.request_id == request.request_id
    assert response.flow_id == request.flow_id
    assert response.stage == 3
    assert response.action == "ask_question"
    assert transport.session_id == "stage-3-session"
    assert transport.request is not None
    assert UUID(str(transport.request["requestId"])) == request.request_id
    assert [message["role"] for message in transport.messages] == [
        "user",
        "assistant",
        "user",
    ]
    assert transport.messages[0]["content"] == "用户本次回答：\n第一轮回答"
    assert "用户本次回答：\n连锁家具门店采购" in result.user_message
    assert result.assistant_message.startswith("```json")

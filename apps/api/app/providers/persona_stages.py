import json
from collections.abc import Mapping
from json import JSONDecodeError
from typing import Protocol

from pydantic import ValidationError

from app.models.schemas import (
    PersonaAgentApiTurnResult,
    PersonaAgentTurnRequest,
    PersonaAgentTurnResponse,
    PersonaStage,
)
from app.providers.article import ProviderResponseError
from app.providers.yunbloom_share import ShareTransport


class PersonaStageAgent(Protocol):
    async def turn(self, request: PersonaAgentTurnRequest) -> PersonaAgentApiTurnResult: ...


class PersonaStageAgentRegistry:
    def __init__(
        self,
        agents: Mapping[PersonaStage, PersonaStageAgent] | None = None,
    ) -> None:
        configured = dict(agents or {})
        self._agents: dict[PersonaStage, PersonaStageAgent | None] = {
            1: configured.get(1),
            2: configured.get(2),
            3: configured.get(3),
            4: configured.get(4),
            5: configured.get(5),
        }

    def configured(self, stage: PersonaStage) -> bool:
        return self._agents[stage] is not None

    def get(self, stage: PersonaStage) -> PersonaStageAgent | None:
        return self._agents[stage]

    def all_configured(self) -> bool:
        return all(agent is not None for agent in self._agents.values())


class YunbloomPersonaStageAgent:
    def __init__(self, client: ShareTransport) -> None:
        self._client = client

    async def turn(self, request: PersonaAgentTurnRequest) -> PersonaAgentApiTurnResult:
        payload = request.model_dump(
            mode="json",
            by_alias=True,
            exclude_none=False,
            exclude={"stage_state": {"agent_messages"}},
        )
        user_message = _agent_user_message(request, payload)
        messages: list[dict[str, object]] = [
            {"role": message.role.value, "content": message.content}
            for message in request.stage_state.agent_messages
        ]
        messages.append({"role": "user", "content": user_message})
        completion = await self._client.complete(
            messages=messages,
            session_id=request.stage_state.conversation_id,
        )
        try:
            response = PersonaAgentTurnResponse.model_validate_json(
                _strip_json_fence(completion.content)
            )
        except (JSONDecodeError, ValidationError, ValueError) as error:
            raise ProviderResponseError("阶段 Agent 未返回有效的结构化 JSON") from error
        if response.request_id != request.request_id:
            raise ProviderResponseError("阶段 Agent 返回了错误的请求编号")
        if response.flow_id != request.flow_id:
            raise ProviderResponseError("阶段 Agent 返回了错误的流程编号")
        if response.state_version != request.state_version:
            raise ProviderResponseError("阶段 Agent 返回了过期的状态版本")
        if response.stage != request.stage:
            raise ProviderResponseError("阶段 Agent 返回了错误的阶段")
        return PersonaAgentApiTurnResult(
            response=response,
            userMessage=user_message,
            assistantMessage=completion.content,
        )


def _strip_json_fence(source: str) -> str:
    content = source.strip()
    if not content.startswith("```"):
        return content
    lines = content.splitlines()
    if len(lines) < 3 or lines[-1].strip() != "```":
        return content
    return "\n".join(lines[1:-1]).strip()


def _agent_user_message(
    request: PersonaAgentTurnRequest,
    payload: dict[str, object],
) -> str:
    answer = request.user_message or "（本次没有新的用户文字）"
    return (
        f"用户本次回答：\n{answer}\n\n"
        "以下是本地流程数据，请结合用户本次回答处理，并严格按照系统提示词返回 JSON：\n"
        f"{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}"
    )

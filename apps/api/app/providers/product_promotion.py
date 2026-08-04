import json
from json import JSONDecodeError

from pydantic import ValidationError

from app.models.schemas import (
    ProductPromotionAgentApiTurnResult,
    ProductPromotionAgentResponse,
    ProductPromotionAnswer,
    ProductPromotionTurnRequest,
)
from app.providers.article import ProviderResponseError
from app.providers.yunbloom_share import ShareTransport

MINIMUM_QUESTION_COUNT = 3


class YunbloomProductPromotionAgent:
    def __init__(self, client: ShareTransport) -> None:
        self._client = client

    async def turn(
        self,
        request: ProductPromotionTurnRequest,
    ) -> ProductPromotionAgentApiTurnResult:
        question_count = _question_count(request)
        user_message = _agent_user_message(
            request.answer,
            request.reference_context if not request.messages else None,
            question_count,
        )
        messages: list[dict[str, object]] = [
            {"role": message.role.value, "content": message.content}
            for message in request.messages
        ]
        messages.append({"role": "user", "content": user_message})
        completion = await self._client.complete(
            messages=messages,
            session_id=str(request.session_id),
        )
        try:
            response = ProductPromotionAgentResponse.model_validate_json(
                _strip_json_fence(completion.content)
            )
        except (JSONDecodeError, ValidationError, ValueError) as error:
            raise ProviderResponseError("产品推广 Agent 未返回有效的结构化 JSON") from error
        if response.status == "completed" and question_count < MINIMUM_QUESTION_COUNT:
            raise ProviderResponseError(
                "产品推广 Agent 过早结束问询：至少完成 3 轮产品问题后才能生成文案"
            )
        return ProductPromotionAgentApiTurnResult(
            response=response,
            userMessage=user_message,
            assistantMessage=completion.content,
        )


def _agent_user_message(
    answer: ProductPromotionAnswer,
    reference_context: str | None,
    question_count: int,
) -> str:
    if answer.skipped:
        answer_text = "用户选择跳过当前问题。"
    else:
        parts: list[str] = []
        if answer.selected_options:
            if answer.ranked:
                ranked = "\n".join(
                    f"{index}. {label}"
                    for index, label in enumerate(answer.selected_options, start=1)
                )
                parts.append(f"用户按优先级选择：\n{ranked}")
            else:
                parts.append(f"用户选择：{'、'.join(answer.selected_options)}")
        if answer.custom_input.strip():
            parts.append(f"用户补充：{answer.custom_input.strip()}")
        answer_text = "\n".join(parts)

    sections: list[str] = []
    if reference_context:
        sections.append(
            "以下是该公司的长期用户画像与本地背景资料。"
            "请将其作为背景事实使用，不要要求用户重复提供：\n"
            f"{reference_context}"
        )
    sections.append(f"用户本次回答：\n{answer_text}")
    sections.append(
        f"当前已经完成的产品追问轮数：{question_count}。"
        "完成 3 轮前禁止返回 completed；达到 3 轮后仍需根据产品事实完整度决定继续问询或完成。"
    )
    sections.append("请继续问询或完成文案，并严格按照系统提示词规定的 JSON 格式输出。")
    return "\n\n".join(sections)


def _question_count(request: ProductPromotionTurnRequest) -> int:
    count = 0
    for message in request.messages:
        if message.role.value != "assistant":
            continue
        try:
            payload = json.loads(_strip_json_fence(message.content))
        except (JSONDecodeError, ValueError):
            continue
        if isinstance(payload, dict) and payload.get("status") == "questioning":
            count += 1
    return count


def _strip_json_fence(source: str) -> str:
    content = source.strip()
    if not content.startswith("```"):
        return content
    lines = content.splitlines()
    if len(lines) < 3 or lines[-1].strip() != "```":
        return content
    return "\n".join(lines[1:-1]).strip()

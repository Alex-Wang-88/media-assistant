import json
from json import JSONDecodeError

from pydantic import ValidationError

from app.models.schemas import PlatformContentGenerateRequest, PlatformContentResult
from app.providers.article import ProviderResponseError
from app.providers.yunbloom_share import ShareTransport


class YunbloomPlatformContentAgent:
    def __init__(self, client: ShareTransport) -> None:
        self._client = client

    async def generate(
        self,
        request: PlatformContentGenerateRequest,
    ) -> PlatformContentResult:
        payload = request.model_dump(
            mode="json",
            by_alias=True,
            exclude={"request_id", "session_id", "project_id"},
        )
        completion = await self._client.complete(
            messages=[
                {
                    "role": "user",
                    "content": (
                        "以下是本次平台文案生成的完整输入。"
                        "请按照智能体自身的平台规范和文风完成精修。"
                        "只返回 JSON 对象，字段必须为 title、content，"
                        "不要输出代码围栏或解释。\n\n"
                        f"{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}"
                    ),
                }
            ],
            session_id=str(request.session_id),
        )
        try:
            raw = json.loads(_strip_json_fence(completion.content))
            if not isinstance(raw, dict):
                raise ValueError("平台文案响应必须为 JSON 对象")
            response = PlatformContentResult.model_validate(
                {**raw, "platform": request.platform.value}
            )
        except (JSONDecodeError, ValidationError, ValueError) as error:
            raise ProviderResponseError("平台文案 Agent 未返回有效的标题和正文 JSON") from error
        return response


def _strip_json_fence(source: str) -> str:
    content = source.strip()
    if not content.startswith("```"):
        return content
    lines = content.splitlines()
    if len(lines) < 3 or lines[-1].strip() != "```":
        return content
    return "\n".join(lines[1:-1]).strip()

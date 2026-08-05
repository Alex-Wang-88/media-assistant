import json
from asyncio import sleep
from collections.abc import AsyncIterator
from typing import Protocol
from uuid import uuid4

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.models.schemas import ChatProviderEvent, ChatTextDelta, ChatToolCall
from app.providers.article import ProviderResponseError

JSON_OBJECT = TypeAdapter(dict[str, object])
CHOICES_ADAPTER = TypeAdapter(list[dict[str, object]])


class FunctionCall(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    arguments: str


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    type: str
    function: FunctionCall


class SharedCompletion(BaseModel):
    content: str
    tool_calls: list[ToolCall] = Field(default_factory=lambda: list[ToolCall]())
    cost: int | None = None
    completion_id: int | None = None


class ShareTransport(Protocol):
    async def complete(
        self,
        *,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
        tool_choice: str | None = None,
        session_id: str | None = None,
    ) -> SharedCompletion: ...


class YunbloomShareClient:
    """Client for YunBloom's shared workflow SSE endpoint."""

    def __init__(
        self,
        *,
        url: str,
        api_key: str,
        client: httpx.AsyncClient | None = None,
        max_transport_retries: int = 0,
    ) -> None:
        if not url or not api_key:
            raise ValueError("沄荣共享 API 地址和 Key 均不能为空")
        self._url = url
        self._api_key = api_key
        self._client = client
        self._max_transport_retries = max(0, max_transport_retries)

    async def complete(
        self,
        *,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
        tool_choice: str | None = None,
        session_id: str | None = None,
    ) -> SharedCompletion:
        body: dict[str, object] = {
            "messages": messages,
            "sessionId": session_id or str(uuid4()),
            "source": "api",
            "extra": {},
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = tool_choice or "auto"
            body["extra"] = {"tools": tools, "tool_choice": tool_choice or "auto"}

        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0))
        try:
            for attempt in range(self._max_transport_retries + 1):
                try:
                    response = await client.post(
                        self._url,
                        headers={
                            "Authorization": self._api_key,
                            "Accept": "text/event-stream",
                            "Accept-Encoding": "identity",
                        },
                        json=body,
                    )
                    response.raise_for_status()
                    return parse_share_sse(response.text)
                except httpx.TransportError:
                    if attempt >= self._max_transport_retries:
                        raise
                    await sleep(0.35)
        except httpx.HTTPError as error:
            raise ProviderResponseError(_http_error_message(error)) from error
        finally:
            if owns_client:
                await client.aclose()

    async def stream(
        self,
        *,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
        tool_choice: str | None = None,
        session_id: str | None = None,
    ) -> AsyncIterator[ChatProviderEvent]:
        body = _request_body(
            messages=messages,
            tools=tools,
            tool_choice=tool_choice,
            session_id=session_id,
        )
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0))
        emitted = False
        try:
            async with client.stream(
                "POST",
                self._url,
                headers={
                    "Authorization": self._api_key,
                    "Accept": "text/event-stream",
                    "Accept-Encoding": "identity",
                },
                json=body,
            ) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if "text/event-stream" not in content_type:
                    raise ProviderResponseError("沄荣共享 API 未返回事件流")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if not raw or raw == "[DONE]":
                        continue
                    for event in parse_share_stream_data(raw):
                        emitted = True
                        yield event
            if not emitted:
                raise ProviderResponseError("沄荣共享 API 未返回文本或工具调用")
        except httpx.HTTPError as error:
            raise ProviderResponseError(_http_error_message(error)) from error
        finally:
            if owns_client:
                await client.aclose()


def parse_share_sse(source: str) -> SharedCompletion:
    text_parts: list[str] = []
    tool_calls: list[ToolCall] = []
    cost: int | None = None
    completion_id: int | None = None

    for line in source.splitlines():
        if not line.startswith("data:"):
            continue
        raw = line[5:].strip()
        if not raw or raw == "[DONE]":
            continue
        payload = JSON_OBJECT.validate_python(json.loads(raw))
        end = payload.get("end")
        if isinstance(end, dict):
            typed_end = JSON_OBJECT.validate_python(end)
            raw_cost = typed_end.get("cost")
            raw_id = typed_end.get("completion_id")
            cost = raw_cost if isinstance(raw_cost, int) else None
            completion_id = raw_id if isinstance(raw_id, int) else None
            continue
        if payload.get("role") != "assistant" or payload.get("type") != "data":
            continue
        content = payload.get("content")
        if not isinstance(content, str):
            continue
        nested = _nested_completion(content)
        if nested is None:
            text_parts.append(content)
        else:
            tool_calls.extend(nested)

    if not text_parts and not tool_calls:
        raise ProviderResponseError("沄荣共享 API 未返回文本或工具调用")
    return SharedCompletion(
        content="".join(text_parts),
        tool_calls=tool_calls,
        cost=cost,
        completion_id=completion_id,
    )


def _http_error_message(error: httpx.HTTPError) -> str:
    error_type = type(error).__name__
    if isinstance(error, httpx.HTTPStatusError):
        response = error.response
        return (
            "沄荣共享 API 请求失败"
            f"（HTTP {response.status_code} {response.reason_phrase}，{error_type}）"
        )
    detail = str(error).strip()
    if detail:
        return f"沄荣共享 API 请求失败（{error_type}）：{detail}"
    return f"沄荣共享 API 请求失败（{error_type}）"


def parse_share_stream_data(raw: str) -> list[ChatProviderEvent]:
    payload = JSON_OBJECT.validate_python(json.loads(raw))
    if isinstance(payload.get("end"), dict):
        return []
    if payload.get("role") != "assistant" or payload.get("type") != "data":
        return []
    content = payload.get("content")
    if not isinstance(content, str) or not content:
        return []
    nested = _nested_completion(content)
    if nested is None:
        return [ChatTextDelta(delta=content)]
    events: list[ChatProviderEvent] = [
        ChatToolCall(
            toolCallId=call.id,
            name=call.function.name,
            arguments=call.function.arguments,
            status="requested",
        )
        for call in nested
    ]
    return events


def _request_body(
    *,
    messages: list[dict[str, object]],
    tools: list[dict[str, object]] | None,
    tool_choice: str | None,
    session_id: str | None = None,
) -> dict[str, object]:
    body: dict[str, object] = {
        "messages": messages,
        "sessionId": session_id or str(uuid4()),
        "source": "api",
        "extra": {},
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = tool_choice or "auto"
        body["extra"] = {"tools": tools, "tool_choice": tool_choice or "auto"}
    return body


def _nested_completion(content: str) -> list[ToolCall] | None:
    try:
        payload = JSON_OBJECT.validate_python(json.loads(content))
    except (json.JSONDecodeError, ValueError):
        return None
    try:
        choices = CHOICES_ADAPTER.validate_python(payload.get("choices"))
    except ValueError:
        return None
    calls: list[ToolCall] = []
    for choice in choices:
        message = choice.get("message")
        if not isinstance(message, dict):
            continue
        typed_message = JSON_OBJECT.validate_python(message)
        raw_calls = typed_message.get("tool_calls")
        if not isinstance(raw_calls, list):
            continue
        calls.extend(TypeAdapter(list[ToolCall]).validate_python(raw_calls))
    return calls or None

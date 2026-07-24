from datetime import datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class Platform(StrEnum):
    WECHAT = "wechat"
    TOUTIAO = "toutiao"
    ZHIHU = "zhihu"
    WEIBO = "weibo"
    BILIBILI = "bilibili"
    XIAOHONGSHU = "xiaohongshu"


class ArticleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    platform: Platform
    instruction: str = Field(min_length=1, max_length=20_000)
    knowledge_excerpts: list[str] = Field(default_factory=list, max_length=20)
    strategy_excerpt: str | None = Field(default=None, max_length=20_000)


class ArticleResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    provider: str
    platform: Platform


class PendingArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    project_id: UUID
    relative_path: str
    media_type: str
    content: str
    created_at: datetime


class ArtifactCommit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class ChatRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: ChatRole
    content: str = Field(min_length=1, max_length=100_000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    request_id: UUID = Field(alias="requestId")
    project_id: UUID = Field(alias="projectId")
    messages: list[ChatMessage] = Field(min_length=1, max_length=100)
    knowledge_enabled: bool = Field(alias="knowledgeEnabled")
    strategy_enabled: bool = Field(alias="strategyEnabled")
    auto_execute: bool = Field(alias="autoExecute")


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    agent: Literal["ready", "unconfigured"]


class ChatTextDelta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["text-delta"] = "text-delta"
    delta: str = Field(min_length=1)


class ChatToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    type: Literal["tool-call"] = "tool-call"
    tool_call_id: str = Field(min_length=1, alias="toolCallId")
    name: str = Field(min_length=1)
    arguments: str
    status: Literal["requested", "running", "completed", "failed"] = "requested"
    result: str | None = None


ChatProviderEvent = ChatTextDelta | ChatToolCall

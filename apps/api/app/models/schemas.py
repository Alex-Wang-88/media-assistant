from datetime import datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    session_id: UUID | None = Field(default=None, alias="sessionId")
    project_id: UUID | None = Field(default=None, alias="projectId")
    messages: list[ChatMessage] = Field(min_length=1, max_length=100)
    knowledge_enabled: bool = Field(alias="knowledgeEnabled")
    strategy_enabled: bool = Field(alias="strategyEnabled")
    auto_execute: bool = Field(alias="autoExecute")
    mode: Literal["chat", "persona_setup"] = "chat"
    persona_reference_context: str | None = Field(
        default=None,
        alias="personaReferenceContext",
        max_length=50_000,
    )

    @model_validator(mode="after")
    def require_project_for_regular_chat(self) -> "ChatRequest":
        if self.mode == "chat" and self.project_id is None:
            raise ValueError("普通对话必须指定任务")
        return self


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


type PersonaStage = Literal[1, 2, 3, 4, 5]
type PersonaStageValue = str | bool | list[str] | None


class PersonaStageState(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    stage: PersonaStage
    status: Literal[
        "not_started",
        "collecting",
        "waiting_confirmation",
        "confirmed",
        "needs_revalidation",
    ]
    revision_count: int = Field(ge=0, alias="revisionCount")
    conversation_id: str | None = Field(default=None, alias="conversationId", max_length=200)
    last_assistant_message: str | None = Field(
        default=None,
        alias="lastAssistantMessage",
        max_length=2_000,
    )
    agent_messages: list[ChatMessage] = Field(
        default_factory=list[ChatMessage],
        alias="agentMessages",
        max_length=100,
    )
    stage_data: dict[str, PersonaStageValue] = Field(alias="stageData")
    result: dict[str, PersonaStageValue]


class PersonaAgentTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    request_id: UUID = Field(alias="requestId")
    flow_id: UUID = Field(alias="flowId")
    state_version: int = Field(ge=0, alias="stateVersion")
    stage: PersonaStage
    event: Literal["stage_start", "user_message", "confirm_stage", "modify_stage"]
    user_message: str | None = Field(default=None, alias="userMessage", max_length=20_000)
    reference_context: str | None = Field(
        default=None,
        alias="referenceContext",
        max_length=50_000,
    )
    stage_state: PersonaStageState = Field(alias="stageState")
    confirmed_data: dict[str, dict[str, PersonaStageValue]] = Field(alias="confirmedData")


class PersonaAgentTurnResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    request_id: UUID = Field(alias="requestId")
    flow_id: UUID = Field(alias="flowId")
    state_version: int = Field(ge=0, alias="stateVersion")
    stage: PersonaStage
    action: Literal[
        "ask_question",
        "present_conclusion",
        "complete_stage",
        "generate_final_summary",
    ]
    question: str | None = Field(default=None, min_length=1, max_length=300)
    conclusion: str | None = Field(default=None, min_length=1, max_length=500)
    result_patch: dict[str, PersonaStageValue] = Field(alias="resultPatch")
    final_summary: str | None = Field(
        default=None,
        alias="finalSummary",
        min_length=1,
        max_length=20_000,
    )

    @model_validator(mode="after")
    def require_action_content(self) -> "PersonaAgentTurnResponse":
        if self.action == "ask_question" and self.question is None:
            raise ValueError("提问动作必须包含问题")
        if self.action == "present_conclusion" and self.conclusion is None:
            raise ValueError("展示结论必须包含结论文本")
        if self.action == "generate_final_summary" and self.final_summary is None:
            raise ValueError("最终汇总动作必须包含最终汇总")
        return self


class PersonaAgentApiTurnResult(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    response: PersonaAgentTurnResponse
    user_message: str = Field(alias="userMessage", min_length=1, max_length=100_000)
    assistant_message: str = Field(alias="assistantMessage", min_length=1, max_length=100_000)

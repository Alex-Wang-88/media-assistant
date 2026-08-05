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


class ProductPromotionAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    selected_options: list[str] = Field(
        default_factory=list,
        alias="selectedOptions",
        max_length=8,
    )
    custom_input: str = Field(default="", alias="customInput", max_length=20_000)
    skipped: bool = False
    ranked: bool = False

    @model_validator(mode="after")
    def require_answer(self) -> "ProductPromotionAnswer":
        if not self.skipped and not self.selected_options and not self.custom_input.strip():
            raise ValueError("必须选择选项、填写内容或跳过当前问题")
        return self


class ProductPromotionTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    request_id: UUID = Field(alias="requestId")
    session_id: UUID = Field(alias="sessionId")
    messages: list[ChatMessage] = Field(default_factory=list, max_length=100)
    answer: ProductPromotionAnswer
    reference_context: str | None = Field(
        default=None,
        alias="referenceContext",
        max_length=50_000,
    )


class ProductPromotionOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=200)


class ProductPromotionAgentResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    status: Literal["questioning", "completed"]
    question_id: str | None = Field(default=None, alias="questionId", max_length=80)
    question: str | None = Field(default=None, min_length=1, max_length=500)
    selection_mode: Literal["single", "multiple", "text"] | None = Field(
        default=None,
        alias="selectionMode",
    )
    options: list[ProductPromotionOption] = Field(default_factory=list, max_length=8)
    max_selections: int | None = Field(
        default=None,
        alias="maxSelections",
        ge=1,
        le=8,
    )
    rank_selections: bool = Field(default=False, alias="rankSelections")
    allow_custom_input: bool = Field(default=True, alias="allowCustomInput")
    allow_skip: bool = Field(default=True, alias="allowSkip")
    final_content: str | None = Field(
        default=None,
        alias="finalContent",
        min_length=1,
        max_length=100_000,
    )

    @model_validator(mode="after")
    def require_status_content(self) -> "ProductPromotionAgentResponse":
        if self.status == "questioning":
            if self.question_id is None or self.question is None or self.selection_mode is None:
                raise ValueError("问询状态必须包含问题编号、问题和选择模式")
            if self.selection_mode != "text" and len(self.options) < 2:
                raise ValueError("单选或多选问题必须提供至少两个选项")
            if self.selection_mode == "text" and not self.allow_custom_input:
                raise ValueError("文本问题必须允许手动输入")
            if self.rank_selections and self.selection_mode != "multiple":
                raise ValueError("只有多选问题可以要求优先级排序")
            if self.rank_selections and (self.max_selections or 0) < 2:
                raise ValueError("优先级多选必须设置至少两个最大选择项")
        if self.status == "completed" and self.final_content is None:
            raise ValueError("完成状态必须包含最终文案")
        return self


class ProductPromotionAgentApiTurnResult(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    response: ProductPromotionAgentResponse
    user_message: str = Field(alias="userMessage", min_length=1, max_length=100_000)
    assistant_message: str = Field(alias="assistantMessage", min_length=1, max_length=100_000)


class PlatformContentGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    request_id: UUID = Field(alias="requestId")
    session_id: UUID = Field(alias="sessionId")
    project_id: UUID = Field(alias="projectId")
    platform: Literal[Platform.BILIBILI, Platform.ZHIHU]
    persona_rag: str = Field(alias="personaRag", min_length=1, max_length=50_000)
    product_conversation: list[ChatMessage] = Field(
        alias="productConversation",
        max_length=100,
    )
    product_draft: str = Field(alias="productDraft", min_length=1, max_length=100_000)


class PlatformContentResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: Literal[Platform.BILIBILI, Platform.ZHIHU]
    title: str = Field(min_length=1, max_length=80)
    content: str = Field(min_length=1, max_length=100_000)


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


class PersonaStageOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=200)


class PersonaStageState(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    stage: PersonaStage
    status: Literal[
        "not_started",
        "collecting",
        "waiting_confirmation",
        "selection_required",
        "confirmed",
        "skipped",
        "needs_revalidation",
    ]
    revision_count: int = Field(ge=0, alias="revisionCount")
    question_count: int = Field(default=0, ge=0, alias="questionCount")
    mode: Literal["normal", "selection"] = "normal"
    options: list[PersonaStageOption] = Field(default_factory=list, max_length=4)
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
    event: Literal[
        "stage_start",
        "user_message",
        "confirm_stage",
        "modify_stage",
        "select_option",
        "skip_stage",
    ]
    user_message: str | None = Field(default=None, alias="userMessage", max_length=20_000)
    selected_option: PersonaStageOption | None = Field(default=None, alias="selectedOption")
    max_question_count: Literal[5] = Field(alias="maxQuestionCount")
    must_converge: bool = Field(alias="mustConverge")
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
        "show_selection",
        "present_conclusion",
        "complete_stage",
        "generate_final_summary",
    ]
    question: str | None = Field(default=None, min_length=1, max_length=300)
    conclusion: str | None = Field(default=None, min_length=1, max_length=500)
    result_patch: dict[str, PersonaStageValue] = Field(alias="resultPatch")
    options: list[PersonaStageOption] = Field(default_factory=list, max_length=4)
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
        if self.action == "show_selection" and (self.question is None or len(self.options) < 2):
            raise ValueError("选项收敛必须包含说明和二到四个选项")
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

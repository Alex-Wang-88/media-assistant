import { randomUUID } from "node:crypto";
import {
  PERSONA_STAGE_QUESTION_LIMIT,
  type PersonaAgentEvent,
  type PersonaAgentTurnRequest,
  type PersonaAgentTurnResponse,
  type PersonaFlowState,
  type PersonaStage,
  type PersonaStageData,
  type PersonaStageOption,
  type PersonaStageState,
  personaAgentTurnResponseSchema,
  personaFlowStateSchema,
  personaStageWelcome,
} from "@yoom/desktop-contracts";

const PERSONA_STAGE_COUNT = 5;

export function createPersonaFlowState(timestamp = new Date().toISOString()): PersonaFlowState {
  return personaFlowStateSchema.parse({
    version: 1,
    flowId: randomUUID(),
    stateVersion: 0,
    flowCompleted: false,
    currentStage: 1,
    stages: Array.from({ length: PERSONA_STAGE_COUNT }, (_value, index) => ({
      stage: index + 1,
      status: index === 0 ? "collecting" : "not_started",
      revisionCount: 0,
      questionCount: 0,
      mode: "normal",
      options: [],
      conversationId: null,
      lastAssistantMessage: index === 0 ? personaStageWelcome(1) : null,
      agentMessages: [],
      stageData: {},
      result: {},
    })),
    finalSummary: null,
    updatedAt: timestamp,
  });
}

export function buildPersonaAgentTurnRequest(
  flow: PersonaFlowState,
  event: PersonaAgentEvent,
  userMessage: string | null,
  referenceContext: string | null = null,
  selectedOption: PersonaStageOption | null = null,
): PersonaAgentTurnRequest {
  const validated = personaFlowStateSchema.parse(flow);
  if (validated.flowCompleted) throw new Error("本轮画像流程已经完成");
  const stageState = requireStage(validated, validated.currentStage);
  return {
    requestId: randomUUID(),
    flowId: validated.flowId,
    stateVersion: validated.stateVersion,
    stage: validated.currentStage,
    event,
    userMessage,
    selectedOption,
    maxQuestionCount: PERSONA_STAGE_QUESTION_LIMIT,
    mustConverge:
      stageState.questionCount >= PERSONA_STAGE_QUESTION_LIMIT || stageState.mode === "selection",
    referenceContext,
    stageState,
    confirmedData: Object.fromEntries(
      validated.stages
        .filter((stage) => stage.status === "confirmed" || stage.status === "skipped")
        .map((stage) => [`agent_${stage.stage}`, stage.result]),
    ),
  };
}

export function applyPersonaAgentTurnResponse(
  flow: PersonaFlowState,
  rawResponse: PersonaAgentTurnResponse,
  timestamp = new Date().toISOString(),
  conversationTurn?: { userMessage: string; assistantMessage: string },
  requestEvent: PersonaAgentEvent = "user_message",
): PersonaFlowState {
  const current = personaFlowStateSchema.parse(flow);
  const response = normalizePersonaAgentTurnResponse(current, rawResponse);
  if (current.flowCompleted) throw new Error("本轮画像流程已经完成");
  if (response.flowId !== current.flowId) throw new Error("Agent 返回了其他画像流程的结果");
  if (response.stateVersion !== current.stateVersion) throw new Error("Agent 返回结果已经过期");
  if (response.stage !== current.currentStage) throw new Error("Agent 返回了错误阶段的结果");

  const stages = current.stages.map((stage) => ({ ...stage }));
  const stageIndex = response.stage - 1;
  const stage = stages[stageIndex];
  if (!stage) throw new Error("当前画像阶段不存在");
  const stageData = mergeStageData(stage.stageData, response.resultPatch);
  const agentMessages = conversationTurn
    ? [
        ...stage.agentMessages,
        { role: "user" as const, content: conversationTurn.userMessage },
        { role: "assistant" as const, content: conversationTurn.assistantMessage },
      ].slice(-100)
    : stage.agentMessages;
  stages[stageIndex] = { ...stage, stageData, agentMessages };

  let currentStage = current.currentStage;
  let flowCompleted = false;
  let finalSummary = current.finalSummary;

  if (response.action === "ask_question") {
    if (stage.questionCount >= PERSONA_STAGE_QUESTION_LIMIT || stage.mode === "selection") {
      throw new Error("当前阶段已达到提问上限，Agent 必须返回收敛选项");
    }
    stages[stageIndex] = {
      ...stages[stageIndex],
      status: "collecting",
      questionCount: stage.questionCount + 1,
      mode: "normal",
      options: [],
      lastAssistantMessage: response.question,
    };
  } else if (response.action === "show_selection") {
    stages[stageIndex] = {
      ...stages[stageIndex],
      status: "selection_required",
      mode: "selection",
      options: response.options,
      lastAssistantMessage: response.question,
    };
  } else if (response.action === "present_conclusion") {
    stages[stageIndex] = {
      ...stages[stageIndex],
      status: "waiting_confirmation",
      mode: "normal",
      options: [],
      lastAssistantMessage: response.conclusion,
    };
  } else if (response.action === "complete_stage") {
    if (response.stage === PERSONA_STAGE_COUNT) {
      throw new Error("第五阶段确认后必须直接生成最终画像汇总");
    }
    stages[stageIndex] = {
      ...stages[stageIndex],
      status: requestEvent === "skip_stage" ? "skipped" : "confirmed",
      mode: "normal",
      options: [],
      lastAssistantMessage: null,
      result: stageData,
    };
    currentStage = (response.stage + 1) as PersonaStage;
    const nextIndex = currentStage - 1;
    const next = stages[nextIndex];
    if (next) {
      stages[nextIndex] = {
        ...next,
        status: "collecting",
        mode: "normal",
        options: [],
        lastAssistantMessage: personaStageWelcome(currentStage),
      };
    }
  } else if (response.action === "generate_final_summary") {
    if (response.stage !== PERSONA_STAGE_COUNT) {
      throw new Error("只有第五阶段可以生成最终画像汇总");
    }
    stages[stageIndex] = {
      ...stages[stageIndex],
      status: requestEvent === "skip_stage" ? "skipped" : "confirmed",
      mode: "normal",
      options: [],
      lastAssistantMessage: null,
      result: stageData,
    };
    flowCompleted = true;
    finalSummary = response.finalSummary;
  }

  return personaFlowStateSchema.parse({
    ...current,
    stateVersion: current.stateVersion + 1,
    currentStage,
    stages,
    flowCompleted,
    finalSummary,
    updatedAt: timestamp,
  });
}

export function normalizePersonaAgentTurnResponse(
  flow: PersonaFlowState,
  rawResponse: PersonaAgentTurnResponse,
): PersonaAgentTurnResponse {
  const current = personaFlowStateSchema.parse(flow);
  const response = personaAgentTurnResponseSchema.parse(rawResponse);
  const stage = requireStage(current, response.stage);
  const resultPatch = allowedStagePatch(response.stage, response.resultPatch);
  const options =
    response.action === "show_selection"
      ? response.options.filter((option) => option.id !== "__skip__")
      : [];
  const crossedStageBoundary = hasOutOfStageFields(response.stage, response.resultPatch);
  const repeatedQuestion =
    response.action === "ask_question" &&
    normalizeMessage(response.question) === normalizeMessage(stage.lastAssistantMessage) &&
    !hasMeaningfulPatch(resultPatch, stage.stageData);

  if (repeatedQuestion) {
    return personaAgentTurnResponseSchema.parse({
      ...response,
      action: "ask_question",
      question: personaStageRecoveryQuestion(response.stage),
      conclusion: null,
      resultPatch,
      options: [],
      finalSummary: null,
    });
  }
  if (response.action === "present_conclusion") {
    const conclusion = formatPersonaStageConclusion(
      response.stage,
      mergeStageData(stage.stageData, resultPatch),
    );
    if (conclusion) {
      return personaAgentTurnResponseSchema.parse({
        ...response,
        conclusion,
        resultPatch,
        options: [],
      });
    }
  }
  if (
    crossedStageBoundary &&
    (response.action === "ask_question" || response.action === "present_conclusion")
  ) {
    return personaAgentTurnResponseSchema.parse({
      ...response,
      action: "ask_question",
      question: personaStageRecoveryQuestion(response.stage),
      conclusion: null,
      resultPatch,
      options: [],
      finalSummary: null,
    });
  }
  if (
    response.action === "present_conclusion" &&
    !containsConfirmationRequest(response.conclusion)
  ) {
    return personaAgentTurnResponseSchema.parse({
      ...response,
      conclusion: `${response.conclusion?.trim()} 这个判断符合你的实际情况吗？`,
      resultPatch,
      options: [],
    });
  }
  return personaAgentTurnResponseSchema.parse({ ...response, resultPatch, options });
}

export function ensurePersonaStageConversation(flow: PersonaFlowState): PersonaFlowState {
  const current = personaFlowStateSchema.parse(flow);
  const stageIndex = current.currentStage - 1;
  const stage = current.stages[stageIndex];
  if (!stage || stage.conversationId) return current;
  const stages = current.stages.map((candidate, index) =>
    index === stageIndex ? { ...candidate, conversationId: randomUUID() } : candidate,
  );
  return personaFlowStateSchema.parse({ ...current, stages });
}

function requireStage(flow: PersonaFlowState, stage: PersonaStage): PersonaStageState {
  const state = flow.stages[stage - 1];
  if (!state) throw new Error("当前画像阶段不存在");
  return state;
}

function mergeStageData(current: PersonaStageData, patch: PersonaStageData): PersonaStageData {
  return { ...current, ...patch };
}

function normalizeMessage(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function hasMeaningfulPatch(patch: PersonaStageData, current: PersonaStageData): boolean {
  return Object.entries(patch).some(([key, value]) => {
    if (value === null || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return JSON.stringify(value) !== JSON.stringify(current[key]);
  });
}

const ALLOWED_STAGE_FIELDS: Record<number, readonly string[]> = {
  1: [
    "industry",
    "product_or_service",
    "direct_function",
    "purchase_reason",
    "customer_value",
    "content_core_positioning",
    "content_anti_positioning",
    "evidence",
    "uncertainties",
  ],
  2: [
    "actual_user",
    "buyer",
    "payer",
    "decision_maker",
    "priority_audience",
    "purchase_relationship",
    "value_match",
    "evidence",
    "uncertainties",
  ],
  3: [
    "priority_target_customer",
    "customer_stage",
    "core_need",
    "main_problem",
    "usage_scenario",
    "purchase_motivation",
    "decision_factors",
    "action_likelihood",
    "positioning_match",
    "evidence",
    "uncertainties",
  ],
  4: [
    "core_advantages",
    "supporting_advantages",
    "evidence",
    "customer_value",
    "positioning_relationship",
    "content_proof",
    "unverified_claims",
    "uncertainties",
  ],
  5: [
    "wants_leads",
    "wants_consultations",
    "wants_store_visits",
    "wants_sales",
    "primary_conversion_goal",
    "secondary_conversion_goals",
    "later_conversion_results",
    "next_action",
    "conversion_fit",
    "evidence",
    "uncertainties",
  ],
};

function allowedStagePatch(stage: PersonaStage, patch: PersonaStageData): PersonaStageData {
  const allowed = new Set(ALLOWED_STAGE_FIELDS[stage] ?? []);
  return Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
}

function hasOutOfStageFields(stage: PersonaStage, patch: PersonaStageData): boolean {
  const allowed = new Set(ALLOWED_STAGE_FIELDS[stage] ?? []);
  return Object.keys(patch).some((key) => !allowed.has(key));
}

function containsConfirmationRequest(conclusion: string | null): boolean {
  if (!conclusion) return false;
  return (
    /[？?]/.test(conclusion) || /(?:请.*确认|是否符合|符合.*吗|是否正确|认可.*吗)/.test(conclusion)
  );
}

function formatPersonaStageConclusion(stage: PersonaStage, data: PersonaStageData): string | null {
  if (stage === 1) {
    const core = normalizeConclusionPhrase(data.content_core_positioning, "core");
    const anti = normalizeConclusionPhrase(data.content_anti_positioning, "anti");
    if (!core || !anti) return null;
    return withConfirmation(`我会把你的内容重点放在${core}，而不是长期停留在${anti}。`);
  }
  if (stage === 2) {
    const relationship = stageText(data.purchase_relationship);
    const audience = stageText(data.priority_audience);
    if (!relationship && !audience) return null;
    const conclusion = [
      relationship ? `你的实际购买关系是${trimSentence(relationship)}` : null,
      audience ? `内容首先需要影响${trimSentence(audience)}` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join("，");
    return withConfirmation(`${conclusion}。`);
  }
  if (stage === 3) {
    const customer = stageText(data.priority_target_customer);
    const need = stageText(data.core_need);
    if (!customer || !need) return null;
    return withConfirmation(
      `你现阶段最应该优先吸引的是${trimSentence(customer)}，他们最核心的需求是${trimSentence(need)}。`,
    );
  }
  if (stage === 4) {
    const advantages = stageTextList(data.core_advantages);
    if (!advantages) return null;
    return withConfirmation(`你最值得强化的优势是${advantages}，内容需要持续突出这一点。`);
  }
  const primary = stageText(data.primary_conversion_goal);
  const secondary = stageTextList(data.secondary_conversion_goals);
  const nextAction = stageText(data.next_action);
  if (!primary || !nextAction) return null;
  const secondaryClause = secondary ? `，辅助目标是${secondary}` : "";
  return withConfirmation(
    `你的核心转化目标是${trimSentence(primary)}${secondaryClause}。内容应优先推动用户${trimSentence(nextAction)}。`,
  );
}

function normalizeConclusionPhrase(value: unknown, kind: "core" | "anti"): string | null {
  if (typeof value !== "string") return null;
  let phrase = value.trim().replace(/[。；;，,]+$/u, "");
  if (kind === "core") {
    phrase = phrase.replace(/^(?:内容)?(?:应该)?(?:重点)?(?:突出|强化|强调)\s*/u, "");
  } else {
    phrase = phrase
      .replace(/^(?:内容)?(?:应该)?(?:避免|不要)(?:长期)?(?:停留在)?\s*/u, "")
      .replace(/^长期停留在\s*/u, "");
  }
  return phrase || null;
}

function stageText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stageTextList(value: unknown): string | null {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === "string" && Boolean(item));
    return items.length > 0 ? items.map(trimSentence).join("、") : null;
  }
  return stageText(value);
}

function trimSentence(value: string): string {
  return value.trim().replace(/[。；;，,]+$/u, "");
}

function withConfirmation(conclusion: string): string {
  return `${conclusion}\n\n这个判断符合你的实际情况吗？`;
}

function personaStageRecoveryQuestion(stage: PersonaStage): string {
  if (stage === 1) {
    return "第1/5阶段：我们先只确定你目前经营什么业务。请直接说你的主要业务。";
  }
  if (stage === 2) {
    return "第2/5阶段：我们先只确定这项业务主要卖给谁。请直接说主要购买者。";
  }
  if (stage === 3) {
    return "第3/5阶段：我们先只确定你最想优先吸引哪类客户。请直接说这类客户。";
  }
  if (stage === 4) {
    return "第4/5阶段：我们先只确定客户选择你的主要理由。请直接说你认为最重要的优势。";
  }
  return "第5/5阶段：我们先只确定你希望用户采取什么行动。请直接说最优先的目标。";
}

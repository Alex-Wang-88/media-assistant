import type {
  PersonaAgentTurnResponse,
  PersonaFlowState,
  PersonaStageData,
} from "@yoom/desktop-contracts";
import { describe, expect, it } from "vitest";
import {
  applyPersonaAgentTurnResponse,
  buildPersonaAgentTurnRequest,
  createPersonaFlowState,
  ensurePersonaStageConversation,
} from "../src/main/persona-flow";

function response(
  flow: PersonaFlowState,
  values: Partial<PersonaAgentTurnResponse>,
): PersonaAgentTurnResponse {
  return {
    requestId: crypto.randomUUID(),
    flowId: flow.flowId,
    stateVersion: flow.stateVersion,
    stage: flow.currentStage,
    action: "ask_question",
    question: "请补充当前阶段的信息",
    conclusion: null,
    resultPatch: {},
    options: [],
    finalSummary: null,
    ...values,
  };
}

function readyPatch(stage: number): PersonaStageData {
  if (stage === 1) {
    return {
      product_or_service: "进口家具选品服务",
      customer_value: "降低采购试错成本",
      content_core_positioning: "可靠的进口家具选品",
      content_anti_positioning: "只讲进口标签",
    };
  }
  if (stage === 2) {
    return {
      buyer: "家具店采购",
      decision_maker: "家具店老板",
      priority_audience: "最终决策的家具店老板",
      purchase_relationship: "采购筛选，老板决策并付款",
    };
  }
  if (stage === 3) {
    return {
      priority_target_customer: "正在扩充进口家具品类的门店老板",
      core_need: "稳定选品",
      main_problem: "缺少可靠供应来源",
    };
  }
  if (stage === 4) {
    return {
      core_advantages: ["拥有可核验的长期供应商合作"],
      evidence: ["已合作五年"],
      customer_value: "供应更稳定",
    };
  }
  return {
    wants_leads: true,
    wants_consultations: true,
    wants_store_visits: false,
    wants_sales: false,
    primary_conversion_goal: "获得咨询",
    next_action: "主动发送采购需求",
  };
}

function flowAtStage(targetStage: number): PersonaFlowState {
  let flow = createPersonaFlowState();
  for (let stage = 1; stage < targetStage; stage += 1) {
    flow = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        action: "complete_stage",
        question: null,
        resultPatch: readyPatch(stage),
      }),
    );
  }
  return flow;
}

describe("local Persona flow", () => {
  it("starts with five ordered stages and a remote-question limit", () => {
    const flow = createPersonaFlowState("2026-07-31T00:00:00.000Z");

    expect(flow.currentStage).toBe(1);
    expect(flow.stages.map((stage) => stage.stage)).toEqual([1, 2, 3, 4, 5]);
    expect(flow.stages.map((stage) => stage.status)).toEqual([
      "collecting",
      "not_started",
      "not_started",
      "not_started",
      "not_started",
    ]);
    expect(flow.stages[0]?.questionCount).toBe(0);
    expect(flow.stages[0]?.mode).toBe("normal");
    expect(flow.stages[0]?.options).toEqual([]);
  });

  it("keeps a conclusion in the current stage until the user confirms it", () => {
    const flow = createPersonaFlowState();
    const next = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        action: "present_conclusion",
        question: null,
        conclusion: "你的核心价值是帮助家具店降低选品试错成本。这个判断符合实际情况吗？",
        resultPatch: readyPatch(1),
      }),
    );

    expect(next.currentStage).toBe(1);
    expect(next.stages[0]?.status).toBe("waiting_confirmation");
    expect(next.stages[0]?.stageData).toEqual(readyPatch(1));
    expect(next.stages[0]?.lastAssistantMessage).toBe(
      "我会把你的内容重点放在可靠的进口家具选品，而不是长期停留在只讲进口标签。\n\n这个判断符合你的实际情况吗？",
    );
  });

  it("does not expose local field-completeness errors during a natural conclusion", () => {
    const flow = createPersonaFlowState();
    const next = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        action: "present_conclusion",
        question: null,
        conclusion: "当前判断是你主要提供医美服务。",
        resultPatch: { industry: "医美", product_or_service: "医美服务" },
      }),
    );

    expect(next.stages[0]?.status).toBe("waiting_confirmation");
    expect(next.stages[0]?.lastAssistantMessage).toContain("符合你的实际情况吗");
  });

  it("adds a confirmation request when the Agent omits it", () => {
    const flow = createPersonaFlowState();
    const next = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        action: "present_conclusion",
        question: null,
        conclusion: "你的核心价值是帮助家具店降低选品试错成本。",
        resultPatch: readyPatch(1),
      }),
    );

    expect(next.stages[0]?.lastAssistantMessage).toBe(
      "我会把你的内容重点放在可靠的进口家具选品，而不是长期停留在只讲进口标签。\n\n这个判断符合你的实际情况吗？",
    );
  });

  it("formats the first-stage conclusion from structured fields instead of Agent prose", () => {
    const flow = createPersonaFlowState();
    const next = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        action: "present_conclusion",
        question: null,
        conclusion:
          "当前结论：这里是一段包含判断依据、效果解释和不确定信息的冗长内容。这个判断符合你的实际情况吗？",
        resultPatch: {
          content_core_positioning: "突出术后安全评估、风险管理和专业复诊指导。",
          content_anti_positioning: "避免长期停留在单纯展示医美效果上。",
        },
      }),
    );

    expect(next.stages[0]?.lastAssistantMessage).toBe(
      "我会把你的内容重点放在术后安全评估、风险管理和专业复诊指导，而不是长期停留在单纯展示医美效果上。\n\n这个判断符合你的实际情况吗？",
    );
  });

  it("replaces an identical empty repeat with a stage recovery question", () => {
    const flow = createPersonaFlowState();
    const next = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        question: "第1/5阶段：请告诉我，你目前主要经营什么业务？",
        resultPatch: {
          industry: "",
          product_or_service: "",
          evidence: [],
        },
      }),
    );

    expect(next.stages[0]?.lastAssistantMessage).toContain("我们先只确定你目前经营什么业务");
  });

  it("does not show an execution plan that crosses the current stage boundary", () => {
    const flow = createPersonaFlowState();
    const next = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        question: "下面给你一份直播方案和短视频脚本。",
        resultPatch: { industry: "医美", live_broadcast_plan: "每天直播两小时" },
      }),
    );

    expect(next.stages[0]?.lastAssistantMessage).toContain("我们先只确定你目前经营什么业务");
    expect(next.stages[0]?.stageData).toEqual({ industry: "医美" });
  });

  it("keeps a valid current-stage conclusion while discarding extra stage fields", () => {
    const flow = createPersonaFlowState();
    const next = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        action: "present_conclusion",
        question: null,
        conclusion: "下面给你一份直播方案。",
        resultPatch: {
          ...readyPatch(1),
          live_broadcast_plan: "每天直播两小时",
        },
      }),
    );

    expect(next.stages[0]?.status).toBe("waiting_confirmation");
    expect(next.stages[0]?.stageData).toEqual(readyPatch(1));
    expect(next.stages[0]?.lastAssistantMessage).toBe(
      "我会把你的内容重点放在可靠的进口家具选品，而不是长期停留在只讲进口标签。\n\n这个判断符合你的实际情况吗？",
    );
  });

  it.each([
    {
      stage: 2,
      expected:
        "你的实际购买关系是采购筛选，老板决策并付款，内容首先需要影响最终决策的家具店老板。\n\n这个判断符合你的实际情况吗？",
    },
    {
      stage: 3,
      expected:
        "你现阶段最应该优先吸引的是正在扩充进口家具品类的门店老板，他们最核心的需求是稳定选品。\n\n这个判断符合你的实际情况吗？",
    },
    {
      stage: 4,
      expected:
        "你最值得强化的优势是拥有可核验的长期供应商合作，内容需要持续突出这一点。\n\n这个判断符合你的实际情况吗？",
    },
    {
      stage: 5,
      expected:
        "你的核心转化目标是获得咨询。内容应优先推动用户主动发送采购需求。\n\n这个判断符合你的实际情况吗？",
    },
  ])("formats stage $stage conclusions from local structured fields", ({ stage, expected }) => {
    const flow = flowAtStage(stage);
    const next = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        action: "present_conclusion",
        question: null,
        conclusion: "这里是 Agent 自由发挥的长篇内容。",
        resultPatch: readyPatch(stage),
      }),
    );

    expect(next.stages[stage - 1]?.lastAssistantMessage).toBe(expected);
  });

  it("counts only remote questions and forces option convergence after five", () => {
    let flow = createPersonaFlowState();
    expect(flow.stages[0]?.questionCount).toBe(0);

    for (let count = 1; count <= 5; count += 1) {
      flow = applyPersonaAgentTurnResponse(
        flow,
        response(flow, {
          question: `第1/5阶段：第 ${count} 个远程追问`,
          resultPatch: { industry: "家具" },
        }),
      );
    }

    expect(flow.stages[0]?.questionCount).toBe(5);
    const request = buildPersonaAgentTurnRequest(flow, "user_message", "这是第五次回答");
    expect(request.maxQuestionCount).toBe(5);
    expect(request.mustConverge).toBe(true);

    expect(() =>
      applyPersonaAgentTurnResponse(
        flow,
        response(flow, { question: "第1/5阶段：不允许出现的第六个问题" }),
      ),
    ).toThrow("必须返回收敛选项");
  });

  it("stores Agent-generated options and sends a clicked option as structured input", () => {
    let flow = createPersonaFlowState();
    for (let count = 1; count <= 5; count += 1) {
      flow = applyPersonaAgentTurnResponse(
        flow,
        response(flow, { question: `第1/5阶段：追问 ${count}` }),
      );
    }
    const options = [
      { id: "A", label: "以进口家具零售为主要业务" },
      { id: "B", label: "以进口家具选品服务为主要业务" },
    ];
    const selectionFlow = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        action: "show_selection",
        question: "根据前面的信息，请选择更接近实际情况的一项。",
        options,
      }),
    );

    expect(selectionFlow.stages[0]).toMatchObject({
      status: "selection_required",
      mode: "selection",
      questionCount: 5,
      options,
    });
    const request = buildPersonaAgentTurnRequest(
      selectionFlow,
      "select_option",
      `我选择：${options[1]?.label}`,
      null,
      options[1],
    );
    expect(request).toMatchObject({
      event: "select_option",
      selectedOption: options[1],
      mustConverge: true,
    });
  });

  it("marks a locally requested stage skip and continues with partial information", () => {
    const flow = createPersonaFlowState();
    const next = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        action: "complete_stage",
        question: null,
        resultPatch: { industry: "家具" },
      }),
      undefined,
      undefined,
      "skip_stage",
    );

    expect(next.currentStage).toBe(2);
    expect(next.stages[0]).toMatchObject({
      status: "skipped",
      result: { industry: "家具" },
    });
    expect(buildPersonaAgentTurnRequest(next, "stage_start", null).confirmedData).toEqual({
      agent_1: { industry: "家具" },
    });
  });

  it("persists the exact user and assistant messages required for the next API turn", () => {
    const flow = createPersonaFlowState();
    const next = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        question: "第1/5阶段：具体提供哪些医美项目？",
        resultPatch: { industry: "医美" },
      }),
      "2026-07-31T00:00:00.000Z",
      {
        userMessage: "用户本次回答：\n医美",
        assistantMessage: '{"action":"ask_question","question":"具体提供哪些医美项目？"}',
      },
    );

    expect(next.stages[0]?.agentMessages).toEqual([
      { role: "user", content: "用户本次回答：\n医美" },
      {
        role: "assistant",
        content: '{"action":"ask_question","question":"具体提供哪些医美项目？"}',
      },
    ]);
  });

  it("advances only after completing the current stage and inherits confirmed data", () => {
    const flow = createPersonaFlowState();
    const next = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        action: "complete_stage",
        question: null,
        resultPatch: readyPatch(1),
      }),
    );
    const request = buildPersonaAgentTurnRequest(next, "stage_start", null);

    expect(next.currentStage).toBe(2);
    expect(next.stages[0]?.status).toBe("confirmed");
    expect(next.stages[1]?.status).toBe("collecting");
    expect(request.confirmedData).toEqual({ agent_1: readyPatch(1) });
  });

  it("assigns one persistent remote conversation id per stage", () => {
    const flow = createPersonaFlowState();
    const prepared = ensurePersonaStageConversation(flow);
    const repeated = ensurePersonaStageConversation(prepared);

    expect(prepared.stages[0]?.conversationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(repeated.stages[0]?.conversationId).toBe(prepared.stages[0]?.conversationId);
    expect(repeated.stages[1]?.conversationId).toBeNull();
  });

  it("rejects stale or wrong-stage Agent results", () => {
    const flow = createPersonaFlowState();

    expect(() =>
      applyPersonaAgentTurnResponse(
        flow,
        response(flow, {
          stateVersion: flow.stateVersion + 1,
        }),
      ),
    ).toThrow("已经过期");
    expect(() =>
      applyPersonaAgentTurnResponse(
        flow,
        response(flow, {
          stage: 2,
        }),
      ),
    ).toThrow("错误阶段");
  });

  it("allows only the fifth stage to finish the flow", () => {
    let flow = createPersonaFlowState();
    for (let stage = 1; stage < 5; stage += 1) {
      flow = applyPersonaAgentTurnResponse(
        flow,
        response(flow, {
          action: "complete_stage",
          question: null,
          resultPatch: readyPatch(stage),
        }),
      );
    }

    expect(() =>
      applyPersonaAgentTurnResponse(
        flow,
        response(flow, {
          action: "complete_stage",
          question: null,
          resultPatch: readyPatch(5),
        }),
      ),
    ).toThrow("直接生成最终画像汇总");

    const completed = applyPersonaAgentTurnResponse(
      flow,
      response(flow, {
        action: "generate_final_summary",
        question: null,
        resultPatch: readyPatch(5),
        finalSummary: "完整用户画像",
      }),
    );
    expect(completed.flowCompleted).toBe(true);
    expect(completed.finalSummary).toBe("完整用户画像");
    expect(completed.stages[4]?.status).toBe("confirmed");
  });
});

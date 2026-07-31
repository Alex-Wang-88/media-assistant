import type {
  ChatSendInput,
  ChatStreamEvent,
  PersonaAgentTurnRequest,
} from "@yoom/desktop-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentStatus, streamChat, turnPersonaAgent } from "../src/main/chat-client";

const input: ChatSendInput = {
  requestId: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  messages: [{ role: "user", content: "你好" }],
  knowledgeEnabled: true,
  strategyEnabled: false,
  autoExecute: false,
};

const personaInput: PersonaAgentTurnRequest = {
  requestId: crypto.randomUUID(),
  flowId: crypto.randomUUID(),
  stateVersion: 0,
  stage: 3,
  event: "user_message",
  userMessage: "连锁家具门店采购",
  referenceContext: null,
  stageState: {
    stage: 3,
    status: "collecting",
    revisionCount: 0,
    conversationId: crypto.randomUUID(),
    lastAssistantMessage: null,
    agentMessages: [],
    stageData: {},
    result: {},
  },
  confirmedData: {},
};

afterEach(() => vi.unstubAllGlobals());

describe("chat API adapter", () => {
  it("reads agent readiness from the existing health endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "ok", agent: "ready" }), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(getAgentStatus("http://api.test")).resolves.toEqual({ state: "ready" });
  });

  it("reports an unreachable health endpoint without throwing into the renderer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("connection refused"))),
    );
    await expect(getAgentStatus("http://api.test")).resolves.toMatchObject({
      state: "unavailable",
    });
  });

  it("parses split SSE frames incrementally", async () => {
    const encoder = new TextEncoder();
    const source = [
      `data: {"type":"start","requestId":"${input.requestId}"}\n\n`,
      `data: {"type":"text-delta","requestId":"${input.requestId}","delta":"你好"}\n\n`,
      `data: {"type":"finish","requestId":"${input.requestId}"}\n\n`,
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of source) {
          const midpoint = Math.floor(frame.length / 2);
          controller.enqueue(encoder.encode(frame.slice(0, midpoint)));
          controller.enqueue(encoder.encode(frame.slice(midpoint)));
        }
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })),
    );
    const events: ChatStreamEvent[] = [];
    await streamChat(input, (event) => events.push(event), "http://api.test");
    expect(events.map((event) => event.type)).toEqual(["start", "text-delta", "finish"]);
  });

  it("marks server failures as retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "API 未配置" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(streamChat(input, () => undefined, "http://api.test")).rejects.toMatchObject({
      message: "API 未配置",
      retryable: true,
    });
  });

  it("sends structured Persona turns to the dedicated stage endpoint", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            response: {
              requestId: personaInput.requestId,
              flowId: personaInput.flowId,
              stateVersion: 0,
              stage: 3,
              action: "ask_question",
              question: "第3/5阶段：这类客户当前最明显的问题是什么？",
              conclusion: null,
              resultPatch: {},
              finalSummary: null,
            },
            userMessage: "用户本次回答：\n连锁家具门店采购",
            assistantMessage: '{"action":"ask_question"}',
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(turnPersonaAgent(personaInput, "http://api.test")).resolves.toMatchObject({
      response: {
        stage: 3,
        action: "ask_question",
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://api.test/v1/persona/stages/turn",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(personaInput),
      }),
    );
  });
});

import { describe, expect, it } from "vitest";
import { applyChatEvent, type ConversationMessage } from "../src/renderer/src/chat-state";

const requestId = crypto.randomUUID();
const assistantId = "assistant-1";

function initial(): ConversationMessage[] {
  return [
    {
      id: assistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      tools: [],
    },
  ];
}

describe("chat stream state", () => {
  it("appends text deltas without replacing prior output", () => {
    let state = applyChatEvent(initial(), assistantId, {
      type: "text-delta",
      requestId,
      delta: "流式",
    });
    state = applyChatEvent(state, assistantId, {
      type: "text-delta",
      requestId,
      delta: "输出",
    });
    expect(state[0]?.content).toBe("流式输出");
  });

  it("tracks tool status and transitions to a recoverable error", () => {
    let state = applyChatEvent(initial(), assistantId, {
      type: "tool-call",
      requestId,
      toolCallId: "call-1",
      name: "search",
      arguments: '{"query":"test"}',
      status: "running",
    });
    expect(state[0]?.tools[0]?.status).toBe("running");
    state = applyChatEvent(state, assistantId, {
      type: "error",
      requestId,
      message: "连接中断",
      retryable: true,
    });
    expect(state[0]?.status).toBe("error");
    expect(state[0]?.error).toBe("连接中断");
  });
});

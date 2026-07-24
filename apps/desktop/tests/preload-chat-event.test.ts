import { describe, expect, it } from "vitest";
import { expectChatStreamEvent } from "../src/preload/chat-event";

describe("sandboxed preload chat event boundary", () => {
  it("accepts a typed delta without runtime contract dependencies", () => {
    const event = expectChatStreamEvent({
      type: "text-delta",
      requestId: crypto.randomUUID(),
      delta: "实时输出",
    });
    expect(event.type).toBe("text-delta");
  });

  it("rejects malformed event payloads", () => {
    expect(() =>
      expectChatStreamEvent({
        type: "tool-call",
        requestId: crypto.randomUUID(),
        name: "search",
      }),
    ).toThrow("聊天事件字段无效");
  });
});

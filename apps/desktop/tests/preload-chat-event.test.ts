import { describe, expect, it } from "vitest";
import { createChatEventGate, expectChatStreamEvent } from "../src/preload/chat-event";

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

  it("keeps accepting tail events until a delayed terminal event arrives", async () => {
    const requestId = crypto.randomUUID();
    const received: string[] = [];
    const gate = createChatEventGate(requestId, (event) => {
      if (event.type === "text-delta") received.push(event.delta);
    });

    gate.handle({ type: "text-delta", requestId, delta: "你的身份是批发商，" });
    setTimeout(() => {
      gate.handle({ type: "text-delta", requestId, delta: "内容应影响下游零售商。" });
      gate.handle({ type: "finish", requestId });
    }, 0);

    await gate.waitForTerminal(100);
    expect(received.join("")).toBe("你的身份是批发商，内容应影响下游零售商。");
  });

  it("fails instead of waiting forever when the terminal event is missing", async () => {
    const gate = createChatEventGate(crypto.randomUUID(), () => undefined);
    await expect(gate.waitForTerminal(1)).rejects.toThrow("聊天事件流未收到结束事件");
  });
});

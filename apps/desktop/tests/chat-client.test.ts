import type { ChatSendInput, ChatStreamEvent } from "@yoom/desktop-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "../src/main/chat-client";

const input: ChatSendInput = {
  requestId: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  messages: [{ role: "user", content: "你好" }],
  knowledgeEnabled: true,
  strategyEnabled: false,
  autoExecute: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("chat API adapter", () => {
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
});

import type { ChatStreamEvent } from "@yoom/desktop-contracts";

export type ChatEventGate = {
  handle(raw: unknown): void;
  waitForTerminal(timeoutMs?: number): Promise<void>;
};

export function createChatEventGate(
  requestId: string,
  onEvent: (event: ChatStreamEvent) => void,
): ChatEventGate {
  let terminalReceived = false;
  let resolveTerminal: (() => void) | null = null;
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });
  return {
    handle(raw) {
      const event = expectChatStreamEvent(raw);
      if (event.requestId !== requestId) return;
      onEvent(event);
      if (event.type === "finish" || event.type === "error") {
        terminalReceived = true;
        resolveTerminal?.();
      }
    },
    async waitForTerminal(timeoutMs = 1_000) {
      if (terminalReceived) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          terminal,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("聊天事件流未收到结束事件")), timeoutMs);
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  };
}

export function expectChatStreamEvent(value: unknown): ChatStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.requestId !== "string") {
    throw new TypeError("聊天事件格式无效");
  }
  switch (value.type) {
    case "start":
    case "finish":
      return value as ChatStreamEvent;
    case "text-delta":
      if (typeof value.delta === "string" && value.delta.length > 0) {
        return value as ChatStreamEvent;
      }
      break;
    case "tool-call":
      if (
        typeof value.toolCallId === "string" &&
        typeof value.name === "string" &&
        typeof value.arguments === "string" &&
        ["requested", "running", "completed", "failed"].includes(String(value.status)) &&
        (value.result === undefined || typeof value.result === "string")
      ) {
        return value as ChatStreamEvent;
      }
      break;
    case "error":
      if (typeof value.message === "string" && typeof value.retryable === "boolean") {
        return value as ChatStreamEvent;
      }
      break;
  }
  throw new TypeError("聊天事件字段无效");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

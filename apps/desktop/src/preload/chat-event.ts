import type { ChatStreamEvent } from "@yoom/desktop-contracts";

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

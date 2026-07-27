import type { ChatStreamEvent } from "@yoom/desktop-contracts";

export type ConversationToolCall = {
  id: string;
  name: string;
  arguments: string;
  status: "requested" | "running" | "completed" | "failed";
  result?: string;
};

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelContent?: string;
  hidden?: boolean;
  modelExcluded?: boolean;
  status: "complete" | "streaming" | "error";
  tools: ConversationToolCall[];
  error?: string;
};

export function applyChatEvent(
  messages: ConversationMessage[],
  assistantId: string,
  event: ChatStreamEvent,
): ConversationMessage[] {
  return messages.map((message) => {
    if (message.id !== assistantId) return message;
    if (event.type === "text-delta") {
      return { ...message, content: message.content + event.delta, status: "streaming" };
    }
    if (event.type === "tool-call") {
      const tool = {
        id: event.toolCallId,
        name: event.name,
        arguments: event.arguments,
        status: event.status,
        ...(event.result === undefined ? {} : { result: event.result }),
      };
      const existing = message.tools.findIndex((candidate) => candidate.id === tool.id);
      const tools =
        existing < 0
          ? [...message.tools, tool]
          : message.tools.map((candidate, index) => (index === existing ? tool : candidate));
      return { ...message, tools, status: "streaming" };
    }
    if (event.type === "finish") return { ...message, status: "complete" };
    if (event.type === "error") {
      return { ...message, status: "error", error: event.message };
    }
    return message;
  });
}

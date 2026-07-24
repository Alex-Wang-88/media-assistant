import {
  type ChatSendInput,
  type ChatStreamEvent,
  chatStreamEventSchema,
} from "@yoom/desktop-contracts";

export class ChatApiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ChatApiError";
    this.retryable = retryable;
  }
}

export async function streamChat(
  input: ChatSendInput,
  onEvent: (event: ChatStreamEvent) => void,
  apiUrl = process.env.YOOM_API_URL ?? "http://127.0.0.1:8000",
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/chat/stream`, {
      method: "POST",
      headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (error) {
    throw new ChatApiError(
      `无法连接本地 AI 服务：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
  if (!response.ok) {
    throw new ChatApiError(await responseErrorMessage(response), response.status >= 500);
  }
  if (!response.body) throw new ChatApiError("AI 服务没有返回事件流", true);

  const decoder = new TextDecoder();
  let buffer = "";
  const reader = response.body.getReader();
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    buffer += decoder.decode(chunk, { stream: true }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      emitFrame(buffer.slice(0, boundary), onEvent);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) emitFrame(buffer, onEvent);
}

function emitFrame(frame: string, onEvent: (event: ChatStreamEvent) => void): void {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return;
  onEvent(chatStreamEventSchema.parse(JSON.parse(data)));
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string") return payload.detail;
  } catch {
    // Fall back to the status text when the server does not return JSON.
  }
  return `AI 服务请求失败（${response.status} ${response.statusText}）`;
}

import type { PersonaFlowState } from "@yoom/desktop-contracts";
import { personaStageWelcome } from "@yoom/desktop-contracts";

export type PersonaTranscriptMessage = {
  role: "user" | "assistant";
  content: string;
};

const STORAGE_PREFIX = "yoom:persona-transcript:";
const NO_USER_TEXT = "（本次没有新的用户文字）";

function storageKey(flowId: string): string {
  return `${STORAGE_PREFIX}${flowId}`;
}

function visibleUserContent(source: string): string | null {
  const marker = "用户本次回答：\n";
  const start = source.indexOf(marker);
  const content = start >= 0 ? source.slice(start + marker.length) : source;
  const end = content.indexOf("\n\n以下是本地流程数据");
  const answer = (end >= 0 ? content.slice(0, end) : content).trim();
  return answer && answer !== NO_USER_TEXT ? answer : null;
}

function visibleAssistantContent(source: string): string | null {
  const fenced = source.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const content = fenced?.[1] ?? source.trim();
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const action = parsed.action;
    if (action === "ask_question" || action === "show_selection") {
      return typeof parsed.question === "string" ? parsed.question.trim() || null : null;
    }
    if (action === "present_conclusion") {
      return typeof parsed.conclusion === "string" ? parsed.conclusion.trim() || null : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function reconstructPersonaTranscript(flow: PersonaFlowState): PersonaTranscriptMessage[] {
  const transcript: PersonaTranscriptMessage[] = [];

  for (const stage of flow.stages) {
    if (stage.agentMessages.length === 0) continue;
    const stageStart = transcript.length;
    transcript.push({ role: "assistant", content: personaStageWelcome(stage.stage) });

    for (const message of stage.agentMessages) {
      const content =
        message.role === "user"
          ? visibleUserContent(message.content)
          : visibleAssistantContent(message.content);
      if (content) transcript.push({ role: message.role, content });
    }

    if (stage.stage === flow.currentStage && stage.lastAssistantMessage) {
      let lastAssistantIndex = -1;
      for (let index = transcript.length - 1; index >= stageStart; index -= 1) {
        if (transcript[index]?.role === "assistant") {
          lastAssistantIndex = index;
          break;
        }
      }
      const currentMessage = {
        role: "assistant" as const,
        content: stage.lastAssistantMessage,
      };
      if (lastAssistantIndex >= 0) transcript[lastAssistantIndex] = currentMessage;
      else transcript.push(currentMessage);
    }

    if (stage.status === "confirmed") {
      transcript.push({ role: "user", content: "确认当前结论" });
    } else if (stage.status === "skipped") {
      transcript.push({ role: "user", content: "跳过本阶段" });
    }
  }

  if (transcript.length === 0) {
    const current = flow.stages[flow.currentStage - 1];
    transcript.push({
      role: "assistant",
      content: current?.lastAssistantMessage ?? personaStageWelcome(flow.currentStage),
    });
  }
  return transcript;
}

export function loadPersonaTranscript(
  storage: Pick<Storage, "getItem">,
  flow: PersonaFlowState,
): PersonaTranscriptMessage[] {
  try {
    const stored = storage.getItem(storageKey(flow.flowId));
    if (!stored) return reconstructPersonaTranscript(flow);
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return reconstructPersonaTranscript(flow);
    const messages = parsed.filter(
      (entry): entry is PersonaTranscriptMessage =>
        Boolean(entry) &&
        (entry.role === "user" || entry.role === "assistant") &&
        typeof entry.content === "string" &&
        entry.content.trim().length > 0,
    );
    return messages.length > 0 ? messages : reconstructPersonaTranscript(flow);
  } catch {
    return reconstructPersonaTranscript(flow);
  }
}

export function savePersonaTranscript(
  storage: Pick<Storage, "setItem">,
  flowId: string,
  messages: PersonaTranscriptMessage[],
): void {
  storage.setItem(storageKey(flowId), JSON.stringify(messages.slice(-200)));
}

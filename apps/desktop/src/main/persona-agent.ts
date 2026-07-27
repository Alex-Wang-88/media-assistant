import { type ChatStreamEvent, personaProfileInputSchema } from "@yoom/desktop-contracts";

export function validatePersonaProposal(event: ChatStreamEvent): ChatStreamEvent {
  if (event.type !== "tool-call" || event.name !== "propose_persona") return event;
  try {
    personaProfileInputSchema.parse(JSON.parse(event.arguments));
    return {
      ...event,
      status: "completed",
      result: "Persona 草稿已生成，等待用户确认",
    };
  } catch (error) {
    return {
      ...event,
      status: "failed",
      result: error instanceof Error ? error.message : String(error),
    };
  }
}

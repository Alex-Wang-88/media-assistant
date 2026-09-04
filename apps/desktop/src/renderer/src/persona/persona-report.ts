import type { ConversationMessage } from "../chat-state";

const PERSONA_REPORT_SECTIONS = [
  "你卖什么",
  "内容核心定位",
  "内容反向定位",
  "卖给谁",
  "目标客户",
  "核心优势",
  "核心转化目标",
  "辅助转化目标",
] as const;

export function personaSetupMessage(
  role: ConversationMessage["role"],
  content: string,
  modelExcluded = false,
): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    status: "complete",
    tools: [],
    ...(modelExcluded ? { modelExcluded: true } : {}),
  };
}

export function parsePersonaReport(source: string): string | null {
  const content = source.trim();
  const matchedSections = PERSONA_REPORT_SECTIONS.filter((section) =>
    new RegExp(`(^|\\n)\\s*(?:#{1,6}\\s*)?${section}\\s*(?:\\n|$)`, "m").test(content),
  );
  if (matchedSections.length < 6 || !matchedSections.includes("核心转化目标")) return null;
  return content.startsWith("# ") ? content : `# 用户画像\n\n${content}`;
}

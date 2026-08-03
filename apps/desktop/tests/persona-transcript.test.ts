import { describe, expect, it } from "vitest";
import { createPersonaFlowState } from "../src/main/persona-flow";
import {
  loadPersonaTranscript,
  reconstructPersonaTranscript,
  savePersonaTranscript,
} from "../src/renderer/src/persona-transcript";

describe("persona transcript persistence", () => {
  it("reconstructs visible messages and removes internal request data", () => {
    const flow = createPersonaFlowState();
    const stage = flow.stages[0];
    if (!stage) throw new Error("缺少第一阶段");
    flow.stateVersion = 1;
    stage.agentMessages = [
      {
        role: "user",
        content:
          '用户本次回答：\n医美\n\n以下是本地流程数据，请结合用户本次回答处理：\n{"stage":1}',
      },
      {
        role: "assistant",
        content:
          '```json\n{"action":"present_conclusion","conclusion":"当前结论","question":null}\n```',
      },
    ];
    stage.lastAssistantMessage = "本地规范化后的结论";
    stage.status = "skipped";

    expect(reconstructPersonaTranscript(flow)).toEqual([
      { role: "assistant", content: "第1/5阶段：请告诉我，你目前主要经营什么业务？" },
      { role: "user", content: "医美" },
      { role: "assistant", content: "本地规范化后的结论" },
      { role: "user", content: "跳过本阶段" },
    ]);
  });

  it("loads the exact visible transcript when one has been saved", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const flow = createPersonaFlowState();
    const messages = [
      { role: "assistant" as const, content: "欢迎语" },
      { role: "user" as const, content: "确认当前结论" },
    ];

    savePersonaTranscript(storage, flow.flowId, messages);

    expect(loadPersonaTranscript(storage, flow)).toEqual(messages);
  });
});

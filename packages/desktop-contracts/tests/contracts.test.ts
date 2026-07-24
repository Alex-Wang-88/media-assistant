import { describe, expect, it } from "vitest";
import {
  agentStatusSchema,
  chatSendInputSchema,
  chatStreamEventSchema,
  createProjectInputSchema,
  deviceCommandSchema,
  publishStartInputSchema,
} from "../src";

describe("desktop contracts", () => {
  it("validates detected agent states", () => {
    expect(agentStatusSchema.parse({ state: "ready" })).toEqual({ state: "ready" });
    expect(agentStatusSchema.safeParse({ state: "working" }).success).toBe(false);
  });

  it("rejects blank task names", () => {
    expect(createProjectInputSchema.safeParse({ name: " " }).success).toBe(false);
  });

  it("rejects publishing without explicit approval", () => {
    expect(
      publishStartInputSchema.safeParse({
        projectId: crypto.randomUUID(),
        artifactPath: "文章/a.md",
        platform: "wechat",
        approved: false,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown remote commands", () => {
    expect(
      deviceCommandSchema.safeParse({
        id: crypto.randomUUID(),
        type: "filesystem.read",
        payload: { path: "C:\\" },
      }).success,
    ).toBe(false);
  });

  it("validates chat requests and rejects untyped stream events", () => {
    const requestId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    expect(
      chatSendInputSchema.safeParse({
        requestId,
        projectId,
        messages: [{ role: "user", content: "你好" }],
        knowledgeEnabled: true,
        strategyEnabled: false,
        autoExecute: false,
      }).success,
    ).toBe(true);
    expect(
      chatStreamEventSchema.safeParse({
        type: "text-delta",
        requestId,
        content: "错误字段",
      }).success,
    ).toBe(false);
  });
});

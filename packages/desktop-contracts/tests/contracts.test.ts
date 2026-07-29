import { describe, expect, it } from "vitest";
import {
  agentStatusSchema,
  chatSendInputSchema,
  chatStreamEventSchema,
  createProjectInputSchema,
  deleteProjectInputSchema,
  deviceCommandSchema,
  personaRagDroppedFilesSchema,
  personaRagStatusSchema,
  personaReportInputSchema,
  publishStartInputSchema,
} from "../src";

describe("desktop contracts", () => {
  it("validates dropped Persona reference files and their total size", () => {
    expect(
      personaRagDroppedFilesSchema.parse([{ name: "brand.txt", data: new Uint8Array([1, 2, 3]) }]),
    ).toHaveLength(1);
    expect(
      personaRagDroppedFilesSchema.safeParse([
        { name: "too-large.bin", data: new Uint8Array(20_000_001) },
      ]).success,
    ).toBe(false);
  });

  it("validates detected agent states", () => {
    expect(agentStatusSchema.parse({ state: "ready" })).toEqual({ state: "ready" });
    expect(agentStatusSchema.safeParse({ state: "working" }).success).toBe(false);
  });

  it("rejects blank task names", () => {
    expect(createProjectInputSchema.safeParse({ name: " " }).success).toBe(false);
  });

  it("requires a valid task id for deletion", () => {
    expect(deleteProjectInputSchema.safeParse({ projectId: crypto.randomUUID() }).success).toBe(
      true,
    );
    expect(deleteProjectInputSchema.safeParse({ projectId: "../任务" }).success).toBe(false);
  });

  it("validates local Persona RAG readiness", () => {
    expect(
      personaRagStatusSchema.parse({
        ready: true,
        fileCount: 1,
        path: "/workspace/企业知识库/用户Persona RAG",
      }),
    ).toMatchObject({ ready: true, fileCount: 1 });
    expect(personaRagStatusSchema.safeParse({ ready: true, fileCount: -1, path: "" }).success).toBe(
      false,
    );
  });

  it("requires a non-empty Markdown report before building Persona RAG", () => {
    expect(
      personaReportInputSchema.safeParse({
        markdown: "# 用户画像\n\n## 你卖什么\n\n进口家具",
      }).success,
    ).toBe(true);
    expect(personaReportInputSchema.safeParse({ markdown: " " }).success).toBe(false);
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
      chatSendInputSchema.safeParse({
        requestId,
        messages: [{ role: "user", content: "开始构建 Persona" }],
        knowledgeEnabled: true,
        strategyEnabled: false,
        autoExecute: false,
        mode: "persona_setup",
      }).success,
    ).toBe(true);
    expect(
      chatSendInputSchema.safeParse({
        requestId,
        messages: [{ role: "user", content: "普通对话" }],
        knowledgeEnabled: true,
        strategyEnabled: false,
        autoExecute: false,
      }).success,
    ).toBe(false);
    expect(
      chatStreamEventSchema.safeParse({
        type: "text-delta",
        requestId,
        content: "错误字段",
      }).success,
    ).toBe(false);
  });
});

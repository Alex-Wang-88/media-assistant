import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validatePersonaProposal } from "../src/main/persona-agent";
import { Workspace } from "../src/main/workspace";

let workspace: Workspace | null = null;
let root: string | null = null;

afterEach(() => {
  workspace?.close();
  workspace = null;
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("Persona RAG local file readiness", () => {
  const profile = {
    brandOverview: "社区咖啡店，提供咖啡和社区活动",
    audience: "附近居民与上班族",
    positioning: "突出手冲咖啡和友好的社区空间",
    fixedFacts: "每天 8:00 至 20:00 营业",
    contentBoundaries: "未经确认不发布优惠信息",
  };

  it("becomes ready only after the guided profile is built and resets when it is deleted", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-persona-rag-"));
    workspace = new Workspace(root);
    const directory = workspace.personaRagPath();

    expect(workspace.personaRagStatus()).toMatchObject({ ready: false, fileCount: 0 });

    const referenceFile = join(directory, "reference.md");
    writeFileSync(referenceFile, "# 只有参考资料\n", "utf8");
    expect(workspace.personaRagStatus()).toMatchObject({ ready: false, fileCount: 1 });

    const toolResult = validatePersonaProposal({
      type: "tool-call",
      requestId: crypto.randomUUID(),
      toolCallId: "propose-persona",
      name: "propose_persona",
      arguments: JSON.stringify(profile),
      status: "requested",
    });
    expect(toolResult).toMatchObject({ type: "tool-call", status: "completed" });
    expect(workspace.personaRagStatus()).toMatchObject({ ready: false, fileCount: 1 });

    workspace.buildPersonaRag(profile);
    expect(workspace.personaRagStatus()).toMatchObject({ ready: true, fileCount: 2 });
    expect(workspace.personaRagReferenceContext()).toContain("当前 Persona 主文件");
    expect(workspace.personaRagReferenceContext()).toContain("社区咖啡店");

    unlinkSync(join(directory, "persona.md"));
    expect(workspace.personaRagStatus()).toMatchObject({ ready: false, fileCount: 1 });
  });

  it("uploads nested reference material without treating it as a completed Persona", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-persona-rag-nested-"));
    workspace = new Workspace(root);
    const directory = workspace.personaRagPath();
    const source = join(root, "menu.txt");
    writeFileSync(source, "菜单", "utf8");
    expect(workspace.importPersonaRagFiles([source])).toEqual(["menu.txt"]);

    writeFileSync(join(directory, ".DS_Store"), "metadata", "utf8");
    expect(workspace.personaRagStatus()).toMatchObject({ ready: false, fileCount: 1 });
  });

  it("rejects an invalid Agent proposal without creating the Persona file", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-persona-rag-invalid-"));
    workspace = new Workspace(root);
    const result = validatePersonaProposal({
      type: "tool-call",
      requestId: crypto.randomUUID(),
      toolCallId: "proposal-invalid",
      name: "propose_persona",
      arguments: '{"brandOverview":"缺少其他字段"}',
      status: "requested",
    });

    expect(result).toMatchObject({ type: "tool-call", status: "failed" });
    expect(workspace.personaRagStatus().ready).toBe(false);
  });
});

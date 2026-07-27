import { existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { validatePersonaProposal } from "../src/main/persona-agent";
import { Workspace } from "../src/main/workspace";

let workspace: Workspace | null = null;
let root: string | null = null;

function minimalStoredDocx(text: string): Uint8Array<ArrayBuffer> {
  const name = Buffer.from("word/document.xml");
  const body = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const compressed = deflateRawSync(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(name.length, 28);
  const centralOffset = local.length + name.length + compressed.length;
  const centralSize = central.length + name.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  const archive = Buffer.concat([local, name, compressed, central, name, end]);
  const result = new Uint8Array(new ArrayBuffer(archive.length));
  result.set(archive);
  return result;
}

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
  const completedDocument = {
    status: "completed" as const,
    profile: {
      industry: "餐饮与食品",
      account_represents: "门店",
      business_type: "社区咖啡店",
      offerings: ["手冲咖啡", "社区活动"],
      target_audiences: ["附近居民", "上班族"],
      customer_scenarios: ["通勤", "周末休闲"],
      memory_points: ["友好的社区空间"],
      long_term_topics: ["咖啡知识"],
      fixed_facts: ["每天 8:00 至 20:00 营业"],
      prohibited_content: ["未经确认不发布优惠信息"],
    },
    current_step: "completed" as const,
    question: null,
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

  it("converts the completed Agent JSON to readable Markdown and saves user edits", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-persona-document-"));
    workspace = new Workspace(root);

    workspace.buildPersonaRag(completedDocument);
    const document = workspace.readPersonaDocument();
    expect(document.path).toBe(join(workspace.personaRagPath(), "persona.md"));
    expect(document.content).toContain("# 用户画像");
    expect(document.content).toContain("- 所属行业：餐饮与食品");
    expect(document.content).toContain("## 目标人群");
    expect(document.content).toContain("- 附近居民");
    expect(document.content).not.toContain('"status": "completed"');

    workspace.savePersonaDocument(`${document.content}\n用户补充内容`);
    expect(workspace.readPersonaDocument().content).toContain("用户补充内容");
  });

  it("deletes the local Persona and references into recoverable workspace trash", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-persona-delete-"));
    workspace = new Workspace(root);
    workspace.buildPersonaRag(completedDocument);
    workspace.importDroppedPersonaRagFiles([
      { name: "brand.txt", data: new TextEncoder().encode("品牌资料") },
    ]);

    expect(workspace.deletePersonaRag()).toMatchObject({ ready: false, fileCount: 0 });
    expect(readdirSync(workspace.personaRagPath())).toEqual([]);
    const trashRoot = join(root, ".yoom", "trash", "用户Persona RAG");
    expect(existsSync(trashRoot)).toBe(true);
    const deletedDirectories = readdirSync(trashRoot);
    expect(deletedDirectories).toHaveLength(1);
    expect(existsSync(join(trashRoot, deletedDirectories[0] as string, "persona.md"))).toBe(true);
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

  it("imports dropped binary files into the reference directory without completing Persona", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-persona-rag-drop-"));
    workspace = new Workspace(root);

    expect(
      workspace.importDroppedPersonaRagFiles([
        { name: "../brand-facts.txt", data: new TextEncoder().encode("品牌事实") },
      ]),
    ).toEqual(["brand-facts.txt"]);
    expect(workspace.personaRagStatus()).toMatchObject({ ready: false, fileCount: 1 });
    expect(workspace.personaRagReferenceContext()).toContain("品牌事实");
  });

  it("extracts DOCX body text before sending reference context to the Agent", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-persona-rag-docx-"));
    workspace = new Workspace(root);

    workspace.importDroppedPersonaRagFiles([
      {
        name: "brand.docx",
        data: minimalStoredDocx("星巴克工业园区门店，主营咖啡和简餐"),
      },
    ]);

    const context = workspace.personaRagReferenceContext();
    expect(context).toContain("[本地参考资料：brand.docx]");
    expect(context).toContain("星巴克工业园区门店，主营咖啡和简餐");
    expect(context).not.toContain("当前格式仅提供文件名");
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

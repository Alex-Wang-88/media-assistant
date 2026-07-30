import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PersistedPublishDraftState } from "@yoom/desktop-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../src/main/workspace";

let workspace: Workspace | null = null;
let root: string | null = null;

afterEach(() => {
  workspace?.close();
  workspace = null;
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

function draftState(): PersistedPublishDraftState {
  const draftId = crypto.randomUUID();
  return {
    version: 1,
    selectedDraftId: draftId,
    drafts: [
      {
        id: draftId,
        title: "持久草稿",
        platform: "bilibili",
        bilibiliAccountId: null,
        content: "应用退出后恢复",
        images: [],
        source: "manual",
        pinned: false,
      },
    ],
    autoPublishByPlatform: {
      wechat: false,
      toutiao: false,
      zhihu: false,
      weibo: false,
      bilibili: false,
      xiaohongshu: false,
    },
  };
}

describe("workspace publish draft persistence", () => {
  it("restores drafts after the workspace is reopened", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-publish-drafts-"));
    workspace = new Workspace(root);
    const state = draftState();
    workspace.savePublishDrafts(state);
    workspace.close();

    workspace = new Workspace(root);
    expect(workspace.loadPublishDrafts()).toEqual(state);
  });

  it("backs up damaged draft data and recovers with an empty result", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-publish-drafts-corrupt-"));
    workspace = new Workspace(root);
    writeFileSync(join(root, ".yoom", "publish-drafts.json"), "{damaged", "utf8");

    expect(workspace.loadPublishDrafts()).toBeNull();
    expect(existsSync(join(root, ".yoom", "publish-drafts.json"))).toBe(false);
    expect(
      readdirSync(join(root, ".yoom", "backups")).some((name) =>
        name.startsWith("publish-drafts.corrupt."),
      ),
    ).toBe(true);
  });
});

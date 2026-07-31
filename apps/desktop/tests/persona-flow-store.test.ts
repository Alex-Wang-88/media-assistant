import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPersonaFlowState } from "../src/main/persona-flow";
import { Workspace } from "../src/main/workspace";

let workspace: Workspace | null = null;
let root: string | null = null;

afterEach(() => {
  workspace?.close();
  workspace = null;
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("workspace Persona flow persistence", () => {
  it("restores the current flow after the workspace is reopened", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-persona-flow-"));
    workspace = new Workspace(root);
    const state = createPersonaFlowState();
    workspace.savePersonaFlow(state);
    workspace.close();

    workspace = new Workspace(root);
    expect(workspace.loadPersonaFlow()).toEqual(state);
  });

  it("backs up damaged flow data and returns no active flow", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-persona-flow-corrupt-"));
    workspace = new Workspace(root);
    writeFileSync(join(root, ".yoom", "persona-flow.json"), "{damaged", "utf8");

    expect(workspace.loadPersonaFlow()).toBeNull();
    expect(existsSync(join(root, ".yoom", "persona-flow.json"))).toBe(false);
    expect(
      readdirSync(join(root, ".yoom", "backups")).some((name) =>
        name.startsWith("persona-flow.corrupt."),
      ),
    ).toBe(true);
  });
});

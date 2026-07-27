import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("workspace task deletion", () => {
  it("moves a task into the workspace trash and removes it from recent tasks", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-delete-"));
    workspace = new Workspace(root);
    const project = workspace.createProject({ name: "待删除对话" });

    workspace.deleteProject(project.id);

    expect(workspace.listProjects()).toEqual([]);
    expect(existsSync(project.path)).toBe(false);
    expect(readdirSync(join(root, ".yoom", "trash", "任务"))).toHaveLength(1);
  });

  it("restores the task directory after a database failure and supports retry", () => {
    root = mkdtempSync(join(tmpdir(), "yoom-delete-retry-"));
    workspace = new Workspace(root);
    const project = workspace.createProject({ name: "可恢复对话" });
    workspace.database.exec(`
      CREATE TRIGGER block_project_delete
      BEFORE DELETE ON projects
      BEGIN
        SELECT RAISE(ABORT, 'blocked');
      END;
    `);

    expect(() => workspace?.deleteProject(project.id)).toThrow();
    expect(existsSync(project.path)).toBe(true);
    expect(workspace.listProjects()).toHaveLength(1);

    workspace.database.exec("DROP TRIGGER block_project_delete");
    workspace.deleteProject(project.id);
    expect(workspace.listProjects()).toEqual([]);
  });
});

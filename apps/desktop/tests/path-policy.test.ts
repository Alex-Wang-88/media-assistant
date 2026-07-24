import { describe, expect, it } from "vitest";
import { resolveInsideProject, sanitizeDirectoryName } from "../src/main/path-policy";

describe("project path policy", () => {
  it("allows paths inside the project", () => {
    expect(resolveInsideProject("C:\\workspace\\task", "文章\\a.md")).toBe(
      "C:\\workspace\\task\\文章\\a.md",
    );
  });

  it("rejects traversal", () => {
    expect(() => resolveInsideProject("C:\\workspace\\task", "..\\secret.txt")).toThrow(
      "项目目录之外",
    );
  });

  it("sanitizes Windows-reserved characters", () => {
    expect(sanitizeDirectoryName('新品: "首发" / 计划')).toBe("新品 首发 计划");
  });
});

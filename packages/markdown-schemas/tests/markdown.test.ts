import { describe, expect, it } from "vitest";
import { parseMarkdown, projectFrontmatterSchema, serializeMarkdown } from "../src";

describe("versioned markdown", () => {
  it("round-trips a project document", () => {
    const frontmatter = {
      schema: "yoom.project/v1" as const,
      id: crypto.randomUUID(),
      name: "新品获客",
      created_at: "2026-07-23T14:30:00+08:00",
    };
    const parsed = parseMarkdown(
      serializeMarkdown(frontmatter, "# 新品获客"),
      projectFrontmatterSchema,
    );
    expect(parsed.frontmatter).toEqual(frontmatter);
    expect(parsed.body).toBe("# 新品获客");
  });

  it("rejects unknown schema versions", () => {
    const source = serializeMarkdown(
      {
        schema: "yoom.project/v2",
        id: crypto.randomUUID(),
        name: "x",
        created_at: "2026-07-23T14:30:00+08:00",
      },
      "",
    );
    expect(() => parseMarkdown(source, projectFrontmatterSchema)).toThrow();
  });
});
